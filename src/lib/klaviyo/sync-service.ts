import type { SupabaseClient } from "@supabase/supabase-js";
import type { KlaviyoConfig } from "@/lib/types/database";
import { syncRecordToGraph } from "@/lib/agentic/graph-sync";

/* ── Constants ─────────────────────────────────────────── */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2025-01-15";
const EXTERNAL_SOURCE = "klaviyo";
const BATCH_SIZE = 50;

/* ── Types ─────────────────────────────────────────────── */

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface KlaviyoListAttributes {
  name: string;
  created: string;
  updated: string;
  opt_in_process: string;
  profile_count: number;
}

interface KlaviyoProfileAttributes {
  email: string | null;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  title: string | null;
  location: {
    city: string | null;
    region: string | null;
    country: string | null;
    zip: string | null;
  } | null;
  properties: Record<string, unknown>;
  created: string;
  updated: string;
}

interface KlaviyoCampaignAttributes {
  name: string;
  status: string;
  archived: boolean;
  audiences: { included: { id: string }[]; excluded: { id: string }[] };
  send_options: Record<string, unknown>;
  tracking_options: Record<string, unknown>;
  send_strategy: Record<string, unknown>;
  created_at: string;
  scheduled_at: string | null;
  updated_at: string;
}

interface KlaviyoResource<T> {
  type: string;
  id: string;
  attributes: T;
  relationships?: Record<string, unknown>;
}

interface KlaviyoListResponse {
  data: KlaviyoResource<KlaviyoListAttributes>[];
  links?: { next?: string | null };
}

interface KlaviyoProfileResponse {
  data: KlaviyoResource<KlaviyoProfileAttributes>[];
  links?: { next?: string | null };
}

interface KlaviyoCampaignResponse {
  data: KlaviyoResource<KlaviyoCampaignAttributes>[];
  links?: { next?: string | null };
}

/* ── API Helpers ───────────────────────────────────────── */

async function klaviyoFetch<T>(
  config: KlaviyoConfig,
  endpoint: string,
  options?: { method?: string; body?: unknown; url?: string }
): Promise<T> {
  const url = options?.url || `${KLAVIYO_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${config.api_key}`,
      revision: config.api_revision || KLAVIYO_REVISION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Klaviyo API ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

/** Validate an API key by fetching the account info */
export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; accountName?: string; error?: string }> {
  try {
    const res = await fetch(`${KLAVIYO_API_BASE}/accounts/`, {
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: false, error: `API error: ${res.status}` };
    }

    const data = await res.json() as { data: Array<{ attributes: { contact_information?: { default_sender_name?: string }; public_api_key?: string } }> };
    const accountName = data.data?.[0]?.attributes?.contact_information?.default_sender_name || "Klaviyo Account";
    return { valid: true, accountName };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

/* ── Sync logging ──────────────────────────────────────── */

export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {}
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

/* ── Import Lists ──────────────────────────────────────── */

export async function importLists(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let nextUrl: string | null = null;

  try {
    // Paginate through all lists
    let page = 0;
    do {
      const response: KlaviyoListResponse = nextUrl
        ? await klaviyoFetch<KlaviyoListResponse>(config, "", { url: nextUrl })
        : await klaviyoFetch<KlaviyoListResponse>(config, "/lists/");

      for (const list of response.data) {
        try {
          const listData = {
            org_id: orgId,
            external_id: list.id,
            external_source: EXTERNAL_SOURCE,
            name: list.attributes.name,
            list_type: "list" as const,
            member_count: list.attributes.profile_count || 0,
            metadata: {
              opt_in_process: list.attributes.opt_in_process,
              klaviyo_created: list.attributes.created,
              klaviyo_updated: list.attributes.updated,
            },
            synced_at: new Date().toISOString(),
          };

          // Dedup by (org_id, external_id, external_source)
          const { data: existing } = await supabase
            .from("klaviyo_lists")
            .select("id")
            .eq("org_id", orgId)
            .eq("external_id", list.id)
            .eq("external_source", EXTERNAL_SOURCE)
            .maybeSingle();

          if (existing) {
            await supabase.from("klaviyo_lists").update(listData).eq("id", existing.id);
            result.updated++;
          } else {
            await supabase.from("klaviyo_lists").insert(listData);
            result.created++;
          }
        } catch (err) {
          console.error(`Klaviyo list import error (${list.id}):`, err);
          result.errors++;
        }
      }

      nextUrl = response.links?.next || null;
      page++;
    } while (nextUrl && page < 100);

    await logSync(supabase, userId, orgId, connectorId, "info",
      `Lists imported: ${result.created} new, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    // Gracefully handle API errors — log but don't break the sync
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("Klaviyo lists import issue:", msg);
    await logSync(supabase, userId, orgId, connectorId,
      msg.includes("403") || msg.includes("401") ? "info" : "warning",
      `Lists import skipped: ${msg}`);
    return result; // Return zeros — don't break the whole sync
  }

  return result;
}

/* ── Import Profiles (Subscribers) ─────────────────────── */

export async function importProfiles(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let nextUrl: string | null = null;
  let page = 0;
  const maxPages = 200; // Safety limit — ~20k profiles at 100/page

  try {
    do {
      const response: KlaviyoProfileResponse = nextUrl
        ? await klaviyoFetch<KlaviyoProfileResponse>(config, "", { url: nextUrl })
        : await klaviyoFetch<KlaviyoProfileResponse>(config, "/profiles/?page[size]=100");

      // Batch process profiles
      const batch = response.data;
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);

        for (const profile of chunk) {
          try {
            const attrs = profile.attributes;
            const profileData = {
              org_id: orgId,
              external_id: profile.id,
              external_source: EXTERNAL_SOURCE,
              email: attrs.email || null,
              phone_number: attrs.phone_number || null,
              first_name: attrs.first_name || null,
              last_name: attrs.last_name || null,
              organization: attrs.organization || null,
              title: attrs.title || null,
              city: attrs.location?.city || null,
              region: attrs.location?.region || null,
              country: attrs.location?.country || null,
              zip: attrs.location?.zip || null,
              properties: attrs.properties || {},
              klaviyo_created_at: attrs.created,
              klaviyo_updated_at: attrs.updated,
              synced_at: new Date().toISOString(),
            };

            const { data: existing } = await supabase
              .from("klaviyo_profiles")
              .select("id")
              .eq("org_id", orgId)
              .eq("external_id", profile.id)
              .eq("external_source", EXTERNAL_SOURCE)
              .maybeSingle();

            if (existing) {
              await supabase.from("klaviyo_profiles").update(profileData).eq("id", existing.id);
              result.updated++;
            } else {
              await supabase.from("klaviyo_profiles").insert(profileData);
              result.created++;
            }
          } catch (err) {
            console.error(`Klaviyo profile import error (${profile.id}):`, err);
            result.errors++;
          }
        }
      }

      nextUrl = response.links?.next || null;
      page++;
    } while (nextUrl && page < maxPages);

    await logSync(supabase, userId, orgId, connectorId, "info",
      `Profiles imported: ${result.created} new, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    console.error("Klaviyo profile import error:", err);
    await logSync(supabase, userId, orgId, connectorId, "error",
      `Profiles import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    throw err;
  }

  return result;
}

/* ── Import Campaigns + Performance Metrics ────────────── */

export async function importCampaigns(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let nextUrl: string | null = null;
  let page = 0;

  try {
    // Import campaigns (email channel only)
    do {
      const response: KlaviyoCampaignResponse = nextUrl
        ? await klaviyoFetch<KlaviyoCampaignResponse>(config, "", { url: nextUrl })
        : await klaviyoFetch<KlaviyoCampaignResponse>(
            config,
            "/campaigns/?filter=equals(messages.channel,'email')"
          );

      for (const campaign of response.data) {
        try {
          const attrs = campaign.attributes;

          const campaignData = {
            org_id: orgId,
            external_id: campaign.id,
            external_source: EXTERNAL_SOURCE,
            name: attrs.name,
            status: attrs.status,
            archived: attrs.archived || false,
            audiences: attrs.audiences || {},
            send_options: attrs.send_options || {},
            tracking_options: attrs.tracking_options || {},
            send_strategy: attrs.send_strategy || {},
            scheduled_at: attrs.scheduled_at || null,
            klaviyo_created_at: attrs.created_at,
            klaviyo_updated_at: attrs.updated_at,
            synced_at: new Date().toISOString(),
          };

          const { data: existing } = await supabase
            .from("klaviyo_campaigns")
            .select("id")
            .eq("org_id", orgId)
            .eq("external_id", campaign.id)
            .eq("external_source", EXTERNAL_SOURCE)
            .maybeSingle();

          if (existing) {
            await supabase.from("klaviyo_campaigns").update(campaignData).eq("id", existing.id);
            result.updated++;
          } else {
            await supabase.from("klaviyo_campaigns").insert(campaignData);
            result.created++;
          }
        } catch (err) {
          console.error(`Klaviyo campaign import error (${campaign.id}):`, err);
          result.errors++;
        }
      }

      nextUrl = response.links?.next || null;
      page++;
    } while (nextUrl && page < 100);

    await logSync(supabase, userId, orgId, connectorId, "info",
      `Campaigns imported: ${result.created} new, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    // Gracefully handle API errors — log but don't break the sync
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("Klaviyo campaigns import issue:", msg);
    await logSync(supabase, userId, orgId, connectorId,
      msg.includes("403") || msg.includes("401") ? "info" : "warning",
      `Campaigns import skipped: ${msg}`);
    return result; // Return zeros — don't break the whole sync
  }

  return result;
}

/* ── Import Campaign Performance Metrics ───────────────── */

export async function importCampaignMetrics(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    // Get all our stored campaigns to fetch metrics for
    const { data: campaigns } = await supabase
      .from("klaviyo_campaigns")
      .select("id, external_id, name")
      .eq("org_id", orgId)
      .eq("external_source", EXTERNAL_SOURCE);

    if (!campaigns || campaigns.length === 0) {
      result.skipped++;
      return result;
    }

    // Fetch campaign values report for all campaign IDs
    const campaignIds = campaigns.map((c) => c.external_id as string);

    // Use the Campaign Values Report endpoint
    // Process in chunks to avoid too-large requests
    for (let i = 0; i < campaignIds.length; i += 25) {
      const chunk = campaignIds.slice(i, i + 25);

      try {
        const reportBody = {
          data: {
            type: "campaign-values-report",
            attributes: {
              statistics: [
                "opens",
                "open_rate",
                "clicks",
                "click_rate",
                "unique_opens",
                "unique_clicks",
                "recipients",
                "bounces",
                "bounce_rate",
                "unsubscribes",
                "unsubscribe_rate",
                "revenue",
                "spam_complaints",
                "deliveries",
                "delivery_rate",
              ],
              timeframe: { key: "all_time" },
              conversion_metric_id: "string", // placeholder
              filter: `in(campaign_id,[${chunk.map((id) => `"${id}"`).join(",")}])`,
            },
          },
        };

        const metricsResponse = await klaviyoFetch<{
          data: {
            attributes: {
              results: Array<{
                group_by: { campaign_id: string };
                statistics: Record<string, number>;
              }>;
            };
          };
        }>(config, "/campaign-values-reports/", {
          method: "POST",
          body: reportBody,
        });

        const reportResults = metricsResponse.data?.attributes?.results ?? [];

        for (const entry of reportResults) {
          const campaignExternalId = entry.group_by?.campaign_id;
          if (!campaignExternalId) continue;

          const localCampaign = campaigns.find((c) => c.external_id === campaignExternalId);
          if (!localCampaign) continue;

          const stats = entry.statistics || {};
          const metricsData = {
            org_id: orgId,
            klaviyo_campaign_id: localCampaign.id as string,
            recipients: stats.recipients || 0,
            deliveries: stats.deliveries || 0,
            delivery_rate: stats.delivery_rate || 0,
            opens: stats.opens || 0,
            unique_opens: stats.unique_opens || 0,
            open_rate: stats.open_rate || 0,
            clicks: stats.clicks || 0,
            unique_clicks: stats.unique_clicks || 0,
            click_rate: stats.click_rate || 0,
            bounces: stats.bounces || 0,
            bounce_rate: stats.bounce_rate || 0,
            unsubscribes: stats.unsubscribes || 0,
            unsubscribe_rate: stats.unsubscribe_rate || 0,
            spam_complaints: stats.spam_complaints || 0,
            revenue: stats.revenue || 0,
            synced_at: new Date().toISOString(),
          };

          const { data: existing } = await supabase
            .from("klaviyo_campaign_metrics")
            .select("id")
            .eq("klaviyo_campaign_id", localCampaign.id)
            .maybeSingle();

          if (existing) {
            await supabase.from("klaviyo_campaign_metrics").update(metricsData).eq("id", existing.id);
            result.updated++;
          } else {
            await supabase.from("klaviyo_campaign_metrics").insert(metricsData);
            result.created++;
          }
        }
      } catch (err) {
        console.error(`Klaviyo metrics import error for chunk:`, err);
        result.errors++;
      }
    }

    await logSync(supabase, userId, orgId, connectorId, "info",
      `Campaign metrics imported: ${result.created} new, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    // Gracefully handle API errors — log but don't break the sync
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("Klaviyo metrics import issue:", msg);
    await logSync(supabase, userId, orgId, connectorId,
      msg.includes("403") || msg.includes("401") ? "info" : "warning",
      `Campaign metrics import skipped: ${msg}`);
    return result; // Return zeros — don't break the whole sync
  }

  return result;
}

/* ── Import Campaign HTML Content as Brand Assets ──────── */

export async function importCampaignTemplates(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    // Fetch templates from Klaviyo
    let nextUrl: string | null = null;
    let page = 0;

    type TemplateResponse = {
      data: Array<{ id: string; attributes: { name: string; html: string; text: string; created: string; updated: string } }>;
      links?: { next?: string | null };
    };

    do {
      const response: TemplateResponse = nextUrl
        ? await klaviyoFetch<TemplateResponse>(config, "", { url: nextUrl })
        : await klaviyoFetch<TemplateResponse>(config, "/templates/");

      for (const template of response.data) {
        try {
          const attrs = template.attributes;

          // Check if we already imported this template
          const { data: existing } = await supabase
            .from("email_brand_assets")
            .select("id")
            .eq("org_id", orgId)
            .eq("metadata->>klaviyo_template_id", template.id)
            .maybeSingle();

          if (existing) {
            // Update existing brand asset
            await supabase
              .from("email_brand_assets")
              .update({
                name: `Klaviyo: ${attrs.name}`,
                content_html: attrs.html || null,
                content_text: attrs.text || null,
                metadata: {
                  klaviyo_template_id: template.id,
                  source_tool: "klaviyo",
                  klaviyo_created: attrs.created,
                  klaviyo_updated: attrs.updated,
                  auto_imported: true,
                },
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            result.updated++;
          } else {
            // Create new brand asset
            await supabase.from("email_brand_assets").insert({
              org_id: orgId,
              name: `Klaviyo: ${attrs.name}`,
              asset_type: "html_template",
              content_html: attrs.html || null,
              content_text: attrs.text || null,
              metadata: {
                klaviyo_template_id: template.id,
                source_tool: "klaviyo",
                klaviyo_created: attrs.created,
                klaviyo_updated: attrs.updated,
                auto_imported: true,
              },
              created_by: userId,
            });
            result.created++;
          }
        } catch (err) {
          console.error(`Klaviyo template import error (${template.id}):`, err);
          result.errors++;
        }
      }

      nextUrl = response.links?.next || null;
      page++;
    } while (nextUrl && page < 50);

    await logSync(supabase, userId, orgId, connectorId, "info",
      `Templates imported as brand assets: ${result.created} new, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    // Gracefully handle API errors — log but don't break the sync
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("Klaviyo templates import issue:", msg);
    await logSync(supabase, userId, orgId, connectorId,
      msg.includes("403") || msg.includes("401") ? "info" : "warning",
      `Templates import skipped: ${msg}`);
    return result; // Return zeros — don't break the whole sync
  }

  return result;
}

/* ── Push Segment to Klaviyo List ──────────────────────── */

export async function pushSegmentToList(
  config: KlaviyoConfig,
  supabase: SupabaseClient,
  orgId: string,
  segmentId: string,
  listName: string
): Promise<{ listId: string; profilesAdded: number }> {
  // 1. Create or find the list in Klaviyo
  const listRes = await klaviyoFetch<{ data: { id: string } }>(config, "/lists/", {
    method: "POST",
    body: {
      data: {
        type: "list",
        attributes: { name: listName },
      },
    },
  });
  const listId = listRes.data.id;

  // 2. Get segment members with their emails
  const { data: members } = await supabase
    .from("segment_members")
    .select("ecom_customer_id")
    .eq("segment_id", segmentId)
    .eq("org_id", orgId);

  if (!members || members.length === 0) {
    return { listId, profilesAdded: 0 };
  }

  const customerIds = members.map((m) => m.ecom_customer_id as string);

  // Look up emails
  const { data: customers } = await supabase
    .from("ecom_customers")
    .select("email")
    .eq("org_id", orgId)
    .in("id", customerIds)
    .not("email", "is", null);

  if (!customers || customers.length === 0) {
    return { listId, profilesAdded: 0 };
  }

  // 3. Subscribe profiles to the list in batches
  const emails = customers.map((c) => c.email as string).filter(Boolean);
  let profilesAdded = 0;

  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100);

    await klaviyoFetch(config, `/lists/${listId}/relationships/profiles/`, {
      method: "POST",
      body: {
        data: batch.map((email) => ({
          type: "profile",
          attributes: { email },
        })),
      },
    });

    profilesAdded += batch.length;
  }

  return { listId, profilesAdded };
}

/* ── Send Transactional Email via Klaviyo ──────────────── */

export async function sendTransactionalEmail(
  config: KlaviyoConfig,
  recipientEmail: string,
  subject: string,
  htmlBody: string,
  textBody: string,
  fromEmail?: string,
  fromName?: string
): Promise<{ messageId: string }> {
  // Note: This requires Klaviyo's transactional email to be enabled on the account
  // The API endpoint may vary — this uses the event-based approach
  const result = await klaviyoFetch<{ data: { id: string } }>(config, "/campaign-send-jobs/", {
    method: "POST",
    body: {
      data: {
        type: "campaign-send-job",
        attributes: {
          // This is a placeholder — actual transactional sends
          // may use a different endpoint depending on Klaviyo plan
        },
      },
    },
  });

  return { messageId: result.data?.id || "unknown" };
}

/* ── Get Delivery Stats for a Campaign ─────────────────── */

export async function getDeliveryStats(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("klaviyo_campaign_metrics")
    .select("*")
    .eq("org_id", orgId)
    .eq("klaviyo_campaign_id", campaignId)
    .maybeSingle();

  return data as Record<string, unknown> | null;
}

/* ── Get Klaviyo Summary for System Prompt ─────────────── */

export async function getKlaviyoSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  connected: boolean;
  listCount: number;
  profileCount: number;
  campaignCount: number;
  topCampaigns: Array<{ name: string; open_rate: number; click_rate: number; recipients: number }>;
} | null> {
  try {
    const { data: connector } = await supabase
      .from("data_connectors")
      .select("status")
      .eq("connector_type", "klaviyo")
      .eq("status", "connected")
      .maybeSingle();

    if (!connector) return null;

    const [listsRes, profilesRes, campaignsRes, metricsRes] = await Promise.all([
      supabase.from("klaviyo_lists").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("klaviyo_profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("klaviyo_campaigns").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase
        .from("klaviyo_campaign_metrics")
        .select("klaviyo_campaign_id, open_rate, click_rate, recipients")
        .eq("org_id", orgId)
        .order("open_rate", { ascending: false })
        .limit(5),
    ]);

    // Look up campaign names for top performers
    const topCampaigns: Array<{ name: string; open_rate: number; click_rate: number; recipients: number }> = [];
    if (metricsRes.data) {
      const campaignIds = metricsRes.data.map((m) => m.klaviyo_campaign_id as string);
      const { data: names } = campaignIds.length > 0
        ? await supabase
            .from("klaviyo_campaigns")
            .select("id, name")
            .in("id", campaignIds)
        : { data: [] as Array<{ id: string; name: string }> };

      const nameMap = new Map((names ?? []).map((n) => [n.id, n.name]));
      for (const m of metricsRes.data) {
        topCampaigns.push({
          name: (nameMap.get(m.klaviyo_campaign_id as string) || "Unknown Campaign") as string,
          open_rate: (m.open_rate as number) || 0,
          click_rate: (m.click_rate as number) || 0,
          recipients: (m.recipients as number) || 0,
        });
      }
    }

    return {
      connected: true,
      listCount: listsRes.count ?? 0,
      profileCount: profilesRes.count ?? 0,
      campaignCount: campaignsRes.count ?? 0,
      topCampaigns,
    };
  } catch {
    return null;
  }
}

/* ── Graph Node Sync ────────────────────────────────────── */

/**
 * After a Klaviyo sync, create graph nodes for all imported records.
 * Iterates through klaviyo_profiles, klaviyo_campaigns, and klaviyo_lists
 * and calls syncRecordToGraph for each.
 *
 * Follows the same pattern as Shopify's syncGraphNodes() in
 * src/lib/shopify/sync-service.ts.
 */
export async function syncGraphNodes(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ profiles: number; campaigns: number; lists: number }> {
  const counts = { profiles: 0, campaigns: 0, lists: 0 };

  // Sync profile nodes
  const { data: profiles } = await supabase
    .from("klaviyo_profiles")
    .select("*")
    .eq("org_id", orgId);

  if (profiles) {
    for (const profile of profiles) {
      await syncRecordToGraph(supabase, orgId, "klaviyo_profiles", profile.id, profile);
      counts.profiles++;
    }
  }

  // Sync campaign nodes
  const { data: campaigns } = await supabase
    .from("klaviyo_campaigns")
    .select("*")
    .eq("org_id", orgId);

  if (campaigns) {
    for (const campaign of campaigns) {
      await syncRecordToGraph(supabase, orgId, "klaviyo_campaigns", campaign.id, campaign);
      counts.campaigns++;
    }
  }

  // Sync list nodes
  const { data: lists } = await supabase
    .from("klaviyo_lists")
    .select("*")
    .eq("org_id", orgId);

  if (lists) {
    for (const list of lists) {
      await syncRecordToGraph(supabase, orgId, "klaviyo_lists", list.id, list);
      counts.lists++;
    }
  }

  return counts;
}
