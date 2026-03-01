/**
 * Outreach Write Service
 *
 * Writes data to the Outreach.io API (create prospects, complete tasks,
 * enroll in sequences). Uses JSON:API format.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { outreachFetch, type OutreachConfig } from "./sync-service";

const OUTREACH_API = "https://api.outreach.io/api/v2";

/* ── Types ─────────────────────────────────────────────── */

export interface CreateProspectParams {
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  phone?: string;
  tags?: string[];
}

export interface CreateProspectResult {
  outreachId: string;
  email: string;
  localProspectId?: string;
  crmContactId?: string;
}

export interface CompleteTaskResult {
  taskId: string;
  status: string;
}

export interface EnrollSequenceResult {
  sequenceStateId: string;
  prospectId: string;
  sequenceId: string;
}

/* ── Write Functions ───────────────────────────────────── */

/**
 * Create a new prospect in Outreach, then upsert to local tables + CRM.
 */
export async function createOutreachProspect(
  config: OutreachConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  params: CreateProspectParams,
): Promise<CreateProspectResult> {
  // Build JSON:API body
  const body = {
    data: {
      type: "prospect",
      attributes: {
        emails: [params.email],
        firstName: params.firstName || null,
        lastName: params.lastName || null,
        title: params.title || null,
        company: params.company || null,
        homePhones: params.phone ? [params.phone] : [],
        tags: params.tags || [],
      },
    },
  };

  const data = await outreachFetch(
    `${OUTREACH_API}/prospects`,
    config.access_token,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  const created = data.data[0] || data.data;
  const outreachId = String(
    "id" in created ? created.id : (data as unknown as { data: { id: number } }).data.id,
  );

  // Upsert to local outreach_prospects
  const row = {
    org_id: orgId,
    user_id: userId,
    external_id: outreachId,
    email: params.email,
    first_name: params.firstName || null,
    last_name: params.lastName || null,
    title: params.title || null,
    company_name: params.company || null,
    phone: params.phone || null,
    tags: params.tags || [],
    stage: null,
    owner_email: null,
    engaged_at: null,
    contacted_at: null,
    replied_at: null,
    synced_at: new Date().toISOString(),
  };

  const { data: prospectRow } = await supabase
    .from("outreach_prospects")
    .upsert(row, { onConflict: "org_id,external_id" })
    .select("id")
    .single();

  // Also create/link CRM contact
  let crmContactId: string | undefined;
  const { data: existing } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", params.email.toLowerCase())
    .maybeSingle();

  if (existing) {
    crmContactId = existing.id;
  } else {
    const { data: newContact } = await supabase
      .from("crm_contacts")
      .insert({
        org_id: orgId,
        created_by: userId,
        email: params.email.toLowerCase(),
        first_name: params.firstName || null,
        last_name: params.lastName || null,
        title: params.title || null,
        company_name: params.company || null,
        source: "outreach",
        status: "Active",
      })
      .select("id")
      .single();
    crmContactId = newContact?.id;
  }

  return {
    outreachId,
    email: params.email,
    localProspectId: prospectRow?.id,
    crmContactId,
  };
}

/**
 * Mark an Outreach task as complete via the API, then update local row.
 */
export async function completeOutreachTask(
  config: OutreachConfig,
  supabase: SupabaseClient,
  orgId: string,
  taskExternalId: string,
): Promise<CompleteTaskResult> {
  const body = {
    data: {
      type: "task",
      id: Number(taskExternalId),
      attributes: {
        state: "complete",
        completedAt: new Date().toISOString(),
      },
    },
  };

  await outreachFetch(
    `${OUTREACH_API}/tasks/${taskExternalId}`,
    config.access_token,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );

  // Update local row
  await supabase
    .from("outreach_tasks")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("external_id", taskExternalId);

  return {
    taskId: taskExternalId,
    status: "complete",
  };
}

/**
 * Enroll a prospect into an Outreach sequence by creating a sequenceState.
 */
export async function enrollInOutreachSequence(
  config: OutreachConfig,
  prospectExternalId: string,
  sequenceExternalId: string,
): Promise<EnrollSequenceResult> {
  const body = {
    data: {
      type: "sequenceState",
      relationships: {
        prospect: {
          data: {
            type: "prospect",
            id: Number(prospectExternalId),
          },
        },
        sequence: {
          data: {
            type: "sequence",
            id: Number(sequenceExternalId),
          },
        },
      },
    },
  };

  const data = await outreachFetch(
    `${OUTREACH_API}/sequenceStates`,
    config.access_token,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  const created = data.data[0] || data.data;
  const sequenceStateId = String(
    "id" in created ? created.id : (data as unknown as { data: { id: number } }).data.id,
  );

  return {
    sequenceStateId,
    prospectId: prospectExternalId,
    sequenceId: sequenceExternalId,
  };
}
