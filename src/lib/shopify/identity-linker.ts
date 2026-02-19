/**
 * Identity Linker — auto-links CRM contacts to e-commerce customers.
 *
 * After a Shopify sync, this finds matching records by email (exact,
 * case-insensitive) and creates links in customer_identity_links.
 *
 * Also creates graph edges between linked CRM contact and ecom customer nodes.
 *
 * Match hierarchy:
 * 1. Email exact match (confidence: 1.0)
 * 2. Phone match (confidence: 0.9) — future enhancement
 * 3. Name match (confidence: 0.7) — future enhancement
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGraphNode } from "@/lib/agentic/graph-sync";

interface LinkResult {
  linked: number;
  already_linked: number;
  errors: number;
}

/**
 * Auto-link CRM contacts to e-commerce customers by email.
 * Runs after each Shopify sync.
 */
export async function autoLinkByEmail(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string
): Promise<LinkResult> {
  const result: LinkResult = { linked: 0, already_linked: 0, errors: 0 };

  try {
    // Get all ecom customers with emails
    const { data: ecomCustomers, error: ecomError } = await supabase
      .from("ecom_customers")
      .select("id, email")
      .eq("org_id", orgId)
      .not("email", "is", null)
      .neq("email", "");

    if (ecomError || !ecomCustomers || ecomCustomers.length === 0) {
      return result;
    }

    // Get all CRM contacts with emails
    const { data: crmContacts, error: crmError } = await supabase
      .from("crm_contacts")
      .select("id, email")
      .eq("org_id", orgId)
      .not("email", "is", null)
      .neq("email", "");

    if (crmError || !crmContacts || crmContacts.length === 0) {
      return result;
    }

    // Build email → CRM contact lookup (lowercase)
    const crmByEmail = new Map<string, string>();
    for (const contact of crmContacts) {
      if (contact.email) {
        crmByEmail.set(contact.email.toLowerCase().trim(), contact.id);
      }
    }

    // Get existing links to avoid duplicates
    const { data: existingLinks } = await supabase
      .from("customer_identity_links")
      .select("crm_contact_id, ecom_customer_id")
      .eq("org_id", orgId)
      .eq("is_active", true);

    const existingSet = new Set(
      (existingLinks || []).map(
        (l) => `${l.crm_contact_id}:${l.ecom_customer_id}`
      )
    );

    // Match ecom customers to CRM contacts
    for (const ecom of ecomCustomers) {
      if (!ecom.email) continue;
      const normalizedEmail = ecom.email.toLowerCase().trim();
      const crmContactId = crmByEmail.get(normalizedEmail);

      if (!crmContactId) continue;

      const linkKey = `${crmContactId}:${ecom.id}`;
      if (existingSet.has(linkKey)) {
        result.already_linked++;
        continue;
      }

      try {
        // Create the identity link
        const { error: insertError } = await supabase
          .from("customer_identity_links")
          .insert({
            org_id: orgId,
            crm_contact_id: crmContactId,
            ecom_customer_id: ecom.id,
            match_type: "email_exact",
            confidence: 1.0,
            matched_on: normalizedEmail,
            is_active: true,
            linked_by: userId || null,
          });

        if (insertError) {
          // Unique constraint violation = already exists (race condition)
          if (insertError.code === "23505") {
            result.already_linked++;
          } else {
            console.error("Error creating identity link:", insertError);
            result.errors++;
          }
          continue;
        }

        // Create graph edge between the two nodes
        await createIdentityGraphEdge(supabase, orgId, crmContactId, ecom.id);

        result.linked++;
      } catch (err) {
        console.error("Error linking customer:", err);
        result.errors++;
      }
    }

    return result;
  } catch (err) {
    console.error("Auto-link by email failed:", err);
    return result;
  }
}

/**
 * Create a graph edge between a CRM contact node and an ecom customer node.
 * Edge type: "same_person" (bidirectional identity link).
 */
async function createIdentityGraphEdge(
  supabase: SupabaseClient,
  orgId: string,
  crmContactId: string,
  ecomCustomerId: string
): Promise<void> {
  try {
    // Find graph node for CRM contact
    const { data: crmNode } = await supabase
      .from("graph_nodes")
      .select("id")
      .eq("org_id", orgId)
      .eq("entity_type", "crm_contacts")
      .eq("entity_id", crmContactId)
      .maybeSingle();

    // Find graph node for ecom customer
    const { data: ecomNode } = await supabase
      .from("graph_nodes")
      .select("id")
      .eq("org_id", orgId)
      .eq("entity_type", "ecom_customers")
      .eq("entity_id", ecomCustomerId)
      .maybeSingle();

    if (!crmNode?.id || !ecomNode?.id) return;

    // Create "same_person" edge (CRM contact → ecom customer)
    await supabase.from("graph_edges").upsert(
      {
        org_id: orgId,
        source_node_id: crmNode.id,
        target_node_id: ecomNode.id,
        relation_type: "same_person",
        valid_from: new Date().toISOString(),
      },
      {
        onConflict: "org_id,source_node_id,target_node_id,relation_type,valid_from",
        ignoreDuplicates: true,
      }
    );
  } catch (err) {
    console.error("Error creating identity graph edge:", err);
  }
}

/**
 * Get identity stats for the org — how many are linked, unlinked, etc.
 */
export async function getIdentityStats(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  total_crm_contacts: number;
  total_ecom_customers: number;
  linked: number;
  crm_only: number;
  ecom_only: number;
}> {
  const [crmRes, ecomRes, linksRes] = await Promise.all([
    supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("ecom_customers").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("customer_identity_links").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_active", true),
  ]);

  const totalCrm = crmRes.count ?? 0;
  const totalEcom = ecomRes.count ?? 0;
  const linked = linksRes.count ?? 0;

  return {
    total_crm_contacts: totalCrm,
    total_ecom_customers: totalEcom,
    linked,
    crm_only: totalCrm - linked,
    ecom_only: totalEcom - linked,
  };
}
