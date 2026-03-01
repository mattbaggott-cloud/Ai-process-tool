/**
 * Outreach Sync Service
 *
 * Syncs prospects, sequences, and tasks from Outreach.io API.
 * Outreach uses JSON:API format with cursor-based pagination.
 */

import { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ─────────────────────────────────────────────── */

export interface OutreachConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string[];
  org_name?: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface OutreachApiResponse {
  data: Array<{
    id: number;
    type: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, { data?: { id: number; type: string } | null }>;
  }>;
  links?: {
    next?: string;
  };
}

/* ── Constants ─────────────────────────────────────────── */

const OUTREACH_API = "https://api.outreach.io/api/v2";
const MAX_RECORDS = 1000;
const PAGE_SIZE = 50;
const OUTREACH_TOKEN_URL = "https://api.outreach.io/oauth/token";

/* ── Helpers ───────────────────────────────────────────── */

export async function outreachFetch(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<OutreachApiResponse> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.api+json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Outreach API error ${res.status}: ${body.slice(0, 500)}`,
    );
  }

  return res.json();
}

/**
 * Refresh an Outreach access token.
 */
export async function refreshOutreachToken(
  config: OutreachConfig,
  supabase: SupabaseClient,
  connectorId: string,
): Promise<OutreachConfig> {
  // Check if token is still fresh (5 min buffer)
  if (Date.now() + 5 * 60 * 1000 < config.expires_at) {
    return config;
  }

  if (!config.refresh_token) {
    throw new Error("No refresh token — user must re-authenticate");
  }

  const clientId = process.env.OUTREACH_CLIENT_ID;
  const clientSecret = process.env.OUTREACH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Outreach OAuth credentials not configured");
  }

  const res = await fetch(OUTREACH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: config.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Outreach token refresh failed: ${res.status}`);
  }

  const data = await res.json();

  const updated: OutreachConfig = {
    ...config,
    access_token: data.access_token,
    refresh_token: data.refresh_token || config.refresh_token,
    expires_at: Date.now() + (data.expires_in || 7200) * 1000,
  };

  // Persist
  await supabase
    .from("data_connectors")
    .update({
      config: updated as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectorId);

  return updated;
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Sync prospects from Outreach.
 * Also maps to crm_contacts by email.
 */
export async function syncProspects(
  config: OutreachConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let url: string | null =
    `${OUTREACH_API}/prospects?page[size]=${PAGE_SIZE}&sort=-updatedAt`;
  let fetched = 0;

  while (url && fetched < MAX_RECORDS) {
    const data = await outreachFetch(url, config.access_token);

    for (const record of data.data) {
      try {
        const attrs = record.attributes;

        const row = {
          org_id: orgId,
          user_id: userId,
          external_id: String(record.id),
          email: (attrs.emails as string[] | undefined)?.[0] || null,
          first_name: (attrs.firstName as string) || null,
          last_name: (attrs.lastName as string) || null,
          title: (attrs.title as string) || null,
          company_name: (attrs.company as string) || null,
          phone: (attrs.homePhones as string[] | undefined)?.[0] ||
                 (attrs.mobilePhones as string[] | undefined)?.[0] || null,
          tags: (attrs.tags as string[]) || [],
          stage: (attrs.stage as string) || null,
          owner_email: (attrs.ownerEmail as string) || null,
          engaged_at: (attrs.engagedAt as string) || null,
          contacted_at: (attrs.contactedAt as string) || null,
          replied_at: (attrs.repliedAt as string) || null,
          synced_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("outreach_prospects")
          .upsert(row, { onConflict: "org_id,external_id" });

        if (error) {
          console.error(`Outreach prospect upsert error for ${record.id}:`, error.message);
          result.errors++;
        } else {
          result.created++;
        }

        // Map to CRM contacts by email
        if (row.email) {
          const { data: existing } = await supabase
            .from("crm_contacts")
            .select("id")
            .eq("org_id", orgId)
            .eq("email", row.email.toLowerCase())
            .maybeSingle();

          if (!existing) {
            await supabase.from("crm_contacts").insert({
              org_id: orgId,
              created_by: userId,
              email: row.email.toLowerCase(),
              first_name: row.first_name,
              last_name: row.last_name,
              title: row.title,
              company_name: row.company_name,
              source: "outreach",
              status: "Active",
            });
          }
        }
      } catch (err) {
        console.error(`Outreach prospect error for ${record.id}:`, err);
        result.errors++;
      }
    }

    fetched += data.data.length;
    url = data.links?.next || null;
  }

  return result;
}

/**
 * Sync sequences from Outreach.
 */
export async function syncSequences(
  config: OutreachConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let url: string | null =
    `${OUTREACH_API}/sequences?page[size]=${PAGE_SIZE}`;
  let fetched = 0;

  while (url && fetched < MAX_RECORDS) {
    const data = await outreachFetch(url, config.access_token);

    for (const record of data.data) {
      try {
        const attrs = record.attributes;

        const row = {
          org_id: orgId,
          user_id: userId,
          external_id: String(record.id),
          name: (attrs.name as string) || `Sequence ${record.id}`,
          description: (attrs.description as string) || null,
          enabled: (attrs.enabled as boolean) ?? true,
          sequence_type: (attrs.sequenceType as string) || null,
          step_count: (attrs.stepCount as number) || 0,
          prospect_count: (attrs.prospectCount as number) || 0,
          open_rate: (attrs.openPercentage as number) || null,
          click_rate: (attrs.clickPercentage as number) || null,
          reply_rate: (attrs.replyPercentage as number) || null,
          owner_email: null, // Would need to resolve from relationship
          synced_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("outreach_sequences")
          .upsert(row, { onConflict: "org_id,external_id" });

        if (error) {
          console.error(`Outreach sequence upsert error for ${record.id}:`, error.message);
          result.errors++;
        } else {
          result.created++;
        }
      } catch (err) {
        console.error(`Outreach sequence error for ${record.id}:`, err);
        result.errors++;
      }
    }

    fetched += data.data.length;
    url = data.links?.next || null;
  }

  return result;
}

/**
 * Sync tasks from Outreach.
 */
export async function syncTasks(
  config: OutreachConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let url: string | null =
    `${OUTREACH_API}/tasks?page[size]=${PAGE_SIZE}&sort=-dueAt`;
  let fetched = 0;

  while (url && fetched < MAX_RECORDS) {
    const data = await outreachFetch(url, config.access_token);

    for (const record of data.data) {
      try {
        const attrs = record.attributes;

        const row = {
          org_id: orgId,
          user_id: userId,
          external_id: String(record.id),
          subject: (attrs.subject as string) || null,
          task_type: (attrs.taskType as string) || null,
          status: (attrs.state as string) || null,
          due_at: (attrs.dueAt as string) || null,
          completed_at: (attrs.completedAt as string) || null,
          prospect_external_id: record.relationships?.prospect?.data?.id
            ? String(record.relationships.prospect.data.id)
            : null,
          sequence_external_id: record.relationships?.sequence?.data?.id
            ? String(record.relationships.sequence.data.id)
            : null,
          owner_email: null,
          synced_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("outreach_tasks")
          .upsert(row, { onConflict: "org_id,external_id" });

        if (error) {
          console.error(`Outreach task upsert error for ${record.id}:`, error.message);
          result.errors++;
        } else {
          result.created++;
        }
      } catch (err) {
        console.error(`Outreach task error for ${record.id}:`, err);
        result.errors++;
      }
    }

    fetched += data.data.length;
    url = data.links?.next || null;
  }

  return result;
}

/**
 * Log a sync event to data_sync_log.
 */
export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    connector_id: connectorId,
    event_type: eventType,
    message,
    details,
  });
}
