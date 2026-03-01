/**
 * Campaign Activity Logger — post-send tracking for CRM + Knowledge Graph.
 *
 * After every campaign action (email sent, task completed, bounce), this
 * module automatically:
 *   1. Logs a crm_activities record linked to the contact
 *   2. Creates/updates a `received` graph edge from person→campaign
 *   3. Syncs the activity node to the graph (creates edges to person + campaign)
 *
 * This means when you ask "what outreach have we done with Sarah?" the
 * graph traversal finds all campaign `received` edges + activity nodes,
 * giving a complete timeline alongside CRM activities, calendar meetings,
 * and email threads.
 *
 * Follows the same patterns as calendar logActivities() for dedup.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EmailCustomerVariant,
  CampaignTask,
  StepType,
} from "@/lib/types/database";
import {
  syncRecordToGraphInBackground,
  createEdge,
  ensureGraphNode,
} from "@/lib/agentic/graph-sync";

/* ── Types ─────────────────────────────────────────────── */

interface CampaignSendContext {
  campaignId: string;
  campaignName: string;
  channel: string;
  stepNumber?: number;
}

/* ── Helpers ───────────────────────────────────────────── */

/**
 * Resolve ecom_customer_id → crm_contact_id via customer_identity_links.
 * Returns null if no CRM contact is linked.
 */
async function resolveContactId(
  supabase: SupabaseClient,
  orgId: string,
  ecomCustomerId: string | null,
  customerEmail: string | null,
): Promise<string | null> {
  if (!ecomCustomerId && !customerEmail) return null;

  // Try identity links first (most reliable)
  if (ecomCustomerId) {
    const { data: link } = await supabase
      .from("customer_identity_links")
      .select("crm_contact_id")
      .eq("org_id", orgId)
      .eq("ecom_customer_id", ecomCustomerId)
      .maybeSingle();

    if (link?.crm_contact_id) return link.crm_contact_id as string;
  }

  // Fallback: email match in crm_contacts
  if (customerEmail) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("org_id", orgId)
      .eq("email", customerEmail.toLowerCase())
      .maybeSingle();

    if (contact?.id) return contact.id as string;
  }

  return null;
}

/**
 * Map step_type to CRM activity type.
 */
function stepTypeToActivityType(stepType?: StepType | string): string {
  switch (stepType) {
    case "phone_call":
      return "call";
    case "auto_email":
    case "manual_email":
      return "email";
    case "linkedin_view":
    case "linkedin_connect":
    case "linkedin_message":
      return "social";
    case "custom_task":
      return "task";
    default:
      return "email";
  }
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Log a successful campaign email send to CRM activities + knowledge graph.
 *
 * Called after provider.sendOne() succeeds. Fire-and-forget — does not
 * block the sending loop.
 */
export async function logCampaignSend(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  variant: Pick<
    EmailCustomerVariant,
    "id" | "ecom_customer_id" | "customer_email" | "customer_name" | "subject_line"
  >,
  context: CampaignSendContext,
): Promise<void> {
  try {
    const contactId = await resolveContactId(
      supabase,
      orgId,
      variant.ecom_customer_id,
      variant.customer_email,
    );

    // Dedup: check if we already logged this variant
    if (contactId) {
      const { data: existing } = await supabase
        .from("crm_activities")
        .select("id")
        .eq("org_id", orgId)
        .eq("contact_id", contactId)
        .like("notes", `%campaign_variant_id:${variant.id}%`)
        .maybeSingle();

      if (existing) return; // Already logged
    }

    // 1. Insert CRM activity
    const activitySubject = `Campaign: ${variant.subject_line || context.campaignName}`;
    const activityNotes = [
      `Sent via ${context.channel}`,
      context.stepNumber ? `Step ${context.stepNumber}` : null,
      `campaign_variant_id:${variant.id}`,
      `campaign_id:${context.campaignId}`,
    ]
      .filter(Boolean)
      .join(" | ");

    const { data: activity } = await supabase
      .from("crm_activities")
      .insert({
        org_id: orgId,
        contact_id: contactId,
        type: "email",
        subject: activitySubject.slice(0, 255),
        notes: activityNotes,
        created_by: userId,
        activity_date: new Date().toISOString(),
      })
      .select("id")
      .single();

    // 2. Sync activity to graph (creates activity node + edges to person)
    if (activity?.id) {
      syncRecordToGraphInBackground(
        supabase,
        orgId,
        "crm_activity",
        activity.id as string,
        {
          type: "email",
          subject: activitySubject,
          contact_id: contactId,
          campaign_id: context.campaignId,
        },
        userId,
      );
    }

    // 3. Create `received` graph edge: person → campaign
    if (contactId) {
      const personNodeId = await ensureGraphNode(
        supabase,
        orgId,
        "person",
        contactId,
        variant.customer_name || variant.customer_email || "Unknown",
        variant.customer_email,
      );

      const campaignNodeId = await ensureGraphNode(
        supabase,
        orgId,
        "campaign",
        context.campaignId,
        context.campaignName,
        context.channel,
      );

      if (personNodeId && campaignNodeId) {
        await createEdge(
          supabase,
          orgId,
          personNodeId,
          campaignNodeId,
          "received",
        );
      }
    }
  } catch (err) {
    // Non-fatal — don't let logging failures block sending
    console.error("[campaign-activity-logger] logCampaignSend error:", err);
  }
}

/**
 * Log a completed campaign task to CRM activities + knowledge graph.
 *
 * Called when a rep marks a task as complete (phone call made, LinkedIn
 * message sent, etc.).
 */
export async function logCampaignTaskComplete(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  task: Pick<
    CampaignTask,
    "id" | "campaign_id" | "ecom_customer_id" | "customer_email" | "customer_name" | "title" | "step_type" | "notes"
  >,
  campaignName: string,
): Promise<void> {
  try {
    const contactId = await resolveContactId(
      supabase,
      orgId,
      task.ecom_customer_id,
      task.customer_email,
    );

    // Dedup
    if (contactId) {
      const { data: existing } = await supabase
        .from("crm_activities")
        .select("id")
        .eq("org_id", orgId)
        .eq("contact_id", contactId)
        .like("notes", `%campaign_task_id:${task.id}%`)
        .maybeSingle();

      if (existing) return;
    }

    const activityType = stepTypeToActivityType(task.step_type);
    const activitySubject = task.title || `Campaign task completed: ${campaignName}`;
    const activityNotes = [
      task.notes || null,
      `campaign_task_id:${task.id}`,
      `campaign_id:${task.campaign_id}`,
    ]
      .filter(Boolean)
      .join(" | ");

    // 1. Insert CRM activity
    const { data: activity } = await supabase
      .from("crm_activities")
      .insert({
        org_id: orgId,
        contact_id: contactId,
        type: activityType,
        subject: activitySubject.slice(0, 255),
        notes: activityNotes,
        created_by: userId,
        activity_date: new Date().toISOString(),
      })
      .select("id")
      .single();

    // 2. Sync to graph
    if (activity?.id) {
      syncRecordToGraphInBackground(
        supabase,
        orgId,
        "crm_activity",
        activity.id as string,
        {
          type: activityType,
          subject: activitySubject,
          contact_id: contactId,
          campaign_id: task.campaign_id,
        },
        userId,
      );
    }

    // 3. Create received edge: person → campaign
    if (contactId) {
      const personNodeId = await ensureGraphNode(
        supabase,
        orgId,
        "person",
        contactId,
        task.customer_name || task.customer_email || "Unknown",
        task.customer_email,
      );

      const campaignNodeId = await ensureGraphNode(
        supabase,
        orgId,
        "campaign",
        task.campaign_id,
        campaignName,
        task.step_type,
      );

      if (personNodeId && campaignNodeId) {
        await createEdge(
          supabase,
          orgId,
          personNodeId,
          campaignNodeId,
          "received",
        );
      }
    }
  } catch (err) {
    console.error("[campaign-activity-logger] logCampaignTaskComplete error:", err);
  }
}

/**
 * Log a campaign bounce event.
 *
 * Updates the `received` graph edge with bounce status so the
 * person's timeline shows the bounce.
 */
export async function logCampaignBounce(
  supabase: SupabaseClient,
  orgId: string,
  variant: Pick<
    EmailCustomerVariant,
    "id" | "ecom_customer_id" | "customer_email" | "customer_name"
  >,
  campaignId: string,
  bounceType: "bounce_hard" | "bounce_soft",
): Promise<void> {
  try {
    // Update variant delivery_metrics with bounce info
    await supabase
      .from("email_customer_variants")
      .update({
        delivery_status: "bounced",
        delivery_metrics: {
          bounce_type: bounceType,
          bounced_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", variant.id);

    // Update the received edge properties if it exists
    const contactId = await resolveContactId(
      supabase,
      orgId,
      variant.ecom_customer_id,
      variant.customer_email,
    );

    if (contactId) {
      // Find the person → campaign edge and update its properties
      const personNodeId = await ensureGraphNode(
        supabase,
        orgId,
        "person",
        contactId,
        variant.customer_name || variant.customer_email || "Unknown",
        variant.customer_email,
      );

      if (personNodeId) {
        // Update edge properties via direct update
        await supabase
          .from("graph_edges")
          .update({
            properties: {
              bounce_type: bounceType,
              bounced_at: new Date().toISOString(),
              status: "bounced",
            },
          })
          .eq("org_id", orgId)
          .eq("source_node_id", personNodeId)
          .eq("relation_type", "received");
      }
    }
  } catch (err) {
    console.error("[campaign-activity-logger] logCampaignBounce error:", err);
  }
}
