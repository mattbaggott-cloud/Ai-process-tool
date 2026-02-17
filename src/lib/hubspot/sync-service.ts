import { Client } from "@hubspot/api-client";
import { SupabaseClient } from "@supabase/supabase-js";
import { type HubSpotConfig, type DealStage } from "@/lib/types/database";

/* ── Constants ──────────────────────────────────────────── */

const BATCH_SIZE = 50;

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";

/* ── Default field mappings ─────────────────────────────── */

const DEFAULT_CONTACT_MAP: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
  email: "email",
  phone: "phone",
  jobtitle: "title",
};

const DEFAULT_COMPANY_MAP: Record<string, string> = {
  name: "name",
  domain: "domain",
  industry: "industry",
  numberofemployees: "employees",
  annualrevenue: "annual_revenue",
  description: "description",
  phone: "phone",
};

const DEFAULT_DEAL_MAP: Record<string, string> = {
  dealname: "title",
  amount: "value",
  closedate: "expected_close_date",
};

const DEFAULT_STAGE_MAP: Record<string, DealStage> = {
  appointmentscheduled: "lead",
  qualifiedtobuy: "qualified",
  presentationscheduled: "proposal",
  decisionmakerboughtin: "negotiation",
  contractsent: "negotiation",
  closedwon: "won",
  closedlost: "lost",
};

const HS_LEAD_STATUS_MAP: Record<string, string> = {
  NEW: "lead",
  OPEN: "active",
  IN_PROGRESS: "active",
  OPEN_DEAL: "active",
  UNQUALIFIED: "inactive",
  ATTEMPTED_TO_CONTACT: "lead",
  CONNECTED: "active",
  BAD_TIMING: "inactive",
};

/* ── Types ──────────────────────────────────────────────── */

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

/* ── Helpers ────────────────────────────────────────────── */

export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {}
) {
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    connector_id: connectorId,
    event_type: eventType,
    message,
    details,
  });
}

function getClient(config: HubSpotConfig): Client {
  return new Client({ accessToken: config.access_token });
}

function getFieldMap(config: HubSpotConfig, object: "contacts" | "companies" | "deals"): Record<string, string> {
  const custom = config.field_mappings?.[object];
  if (custom && Object.keys(custom).length > 0) return custom;
  if (object === "contacts") return DEFAULT_CONTACT_MAP;
  if (object === "companies") return DEFAULT_COMPANY_MAP;
  return DEFAULT_DEAL_MAP;
}

function reverseMap(map: Record<string, string>): Record<string, string> {
  const reversed: Record<string, string> = {};
  for (const [hs, local] of Object.entries(map)) {
    reversed[local] = hs;
  }
  return reversed;
}

/* ── Token refresh ──────────────────────────────────────── */

export async function refreshTokenIfNeeded(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  connectorId: string
): Promise<HubSpotConfig> {
  // Refresh if token expires within 5 minutes
  if (config.expires_at > Date.now() + 5 * 60 * 1000) {
    return config;
  }

  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: HUBSPOT_CLIENT_ID,
      client_secret: HUBSPOT_CLIENT_SECRET,
      refresh_token: config.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to refresh HubSpot token");
  }

  const tokens = await res.json();
  const newConfig: HubSpotConfig = {
    ...config,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };

  await supabase
    .from("data_connectors")
    .update({ config: newConfig, updated_at: new Date().toISOString() })
    .eq("id", connectorId);

  return newConfig;
}

/* ── Import: Contacts ───────────────────────────────────── */

export async function importContacts(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "contacts");
  const hsProperties = [...Object.keys(fieldMap), "hs_lead_status", "createdate", "lastmodifieddate"];
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let after: string | undefined;
  let page = 0;

  do {
    const response = await client.crm.contacts.basicApi.getPage(
      BATCH_SIZE, after, hsProperties, undefined, undefined, false
    );

    const contacts = response.results || [];

    for (const hsContact of contacts) {
      try {
        const hsId = hsContact.id;
        const props = hsContact.properties || {};

        // Build local record from field mapping
        const localData: Record<string, unknown> = {
          user_id: userId,
          org_id: orgId,
          source: "import" as const,
          metadata: { hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
        };

        for (const [hsProp, localField] of Object.entries(fieldMap)) {
          if (props[hsProp] !== undefined && props[hsProp] !== null) {
            localData[localField] = props[hsProp];
          }
        }

        // Map lead status
        if (props.hs_lead_status) {
          const mapped = HS_LEAD_STATUS_MAP[props.hs_lead_status.toUpperCase()];
          if (mapped) localData.status = mapped;
        }

        // Dedup: check by hubspot_id first
        const { data: byHsId } = await supabase
          .from("crm_contacts")
          .select("id, updated_at")
          .eq("user_id", userId)
          .eq("metadata->>hubspot_id", hsId)
          .maybeSingle();

        if (byHsId) {
          // Update if HubSpot is newer
          const hsUpdated = props.lastmodifieddate ? new Date(props.lastmodifieddate).getTime() : 0;
          const localUpdated = new Date(byHsId.updated_at).getTime();
          if (hsUpdated > localUpdated) {
            const { metadata: _, user_id: __, source: ___, ...updateFields } = localData;
            await supabase.from("crm_contacts").update({
              ...updateFields,
              metadata: { hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
              updated_at: new Date().toISOString(),
            }).eq("id", byHsId.id);
            result.updated++;
          } else {
            result.skipped++;
          }
          continue;
        }

        // Dedup: check by email
        if (props.email) {
          const { data: byEmail } = await supabase
            .from("crm_contacts")
            .select("id, metadata")
            .eq("user_id", userId)
            .ilike("email", props.email)
            .maybeSingle();

          if (byEmail) {
            // Link existing record to HubSpot
            const existingMeta = (byEmail.metadata || {}) as Record<string, unknown>;
            await supabase.from("crm_contacts").update({
              metadata: { ...existingMeta, hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
              updated_at: new Date().toISOString(),
            }).eq("id", byEmail.id);
            result.updated++;
            continue;
          }
        }

        // Insert new contact
        await supabase.from("crm_contacts").insert(localData);
        result.created++;
      } catch (err) {
        console.error("Error importing contact:", err);
        result.errors++;
      }
    }

    after = response.paging?.next?.after;
    page++;

    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing contacts: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (after);

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Contacts import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);

  return result;
}

/* ── Import: Companies ──────────────────────────────────── */

export async function importCompanies(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "companies");
  const hsProperties = [...Object.keys(fieldMap), "city", "state", "zip", "address", "createdate", "lastmodifieddate"];
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let after: string | undefined;
  let page = 0;

  do {
    const response = await client.crm.companies.basicApi.getPage(
      BATCH_SIZE, after, hsProperties, undefined, undefined, false
    );

    const companies = response.results || [];

    for (const hsCompany of companies) {
      try {
        const hsId = hsCompany.id;
        const props = hsCompany.properties || {};

        const localData: Record<string, unknown> = {
          user_id: userId,
          org_id: orgId,
          metadata: { hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
        };

        for (const [hsProp, localField] of Object.entries(fieldMap)) {
          if (props[hsProp] !== undefined && props[hsProp] !== null) {
            if (localField === "employees" || localField === "annual_revenue") {
              localData[localField] = Number(props[hsProp]) || null;
            } else {
              localData[localField] = props[hsProp];
            }
          }
        }

        // Compose address from parts
        const addressParts = [props.address, props.city, props.state, props.zip].filter(Boolean);
        if (addressParts.length > 0) {
          localData.address = addressParts.join(", ");
        }

        // Dedup: check by hubspot_id first
        const { data: byHsId } = await supabase
          .from("crm_companies")
          .select("id, updated_at")
          .eq("user_id", userId)
          .eq("metadata->>hubspot_id", hsId)
          .maybeSingle();

        if (byHsId) {
          const hsUpdated = props.lastmodifieddate ? new Date(props.lastmodifieddate).getTime() : 0;
          const localUpdated = new Date(byHsId.updated_at).getTime();
          if (hsUpdated > localUpdated) {
            const { metadata: _, user_id: __, ...updateFields } = localData;
            await supabase.from("crm_companies").update({
              ...updateFields,
              metadata: { hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
              updated_at: new Date().toISOString(),
            }).eq("id", byHsId.id);
            result.updated++;
          } else {
            result.skipped++;
          }
          continue;
        }

        // Dedup: check by domain
        if (props.domain) {
          const { data: byDomain } = await supabase
            .from("crm_companies")
            .select("id, metadata")
            .eq("user_id", userId)
            .ilike("domain", props.domain)
            .maybeSingle();

          if (byDomain) {
            const existingMeta = (byDomain.metadata || {}) as Record<string, unknown>;
            await supabase.from("crm_companies").update({
              metadata: { ...existingMeta, hubspot_id: hsId, hubspot_updated_at: props.lastmodifieddate },
              updated_at: new Date().toISOString(),
            }).eq("id", byDomain.id);
            result.updated++;
            continue;
          }
        }

        // Insert new company
        await supabase.from("crm_companies").insert(localData);
        result.created++;
      } catch (err) {
        console.error("Error importing company:", err);
        result.errors++;
      }
    }

    after = response.paging?.next?.after;
    page++;

    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing companies: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (after);

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Companies import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);

  return result;
}

/* ── Import: Deals ──────────────────────────────────────── */

export async function importDeals(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "deals");
  const hsProperties = [...Object.keys(fieldMap), "dealstage", "pipeline", "hubspot_owner_id", "createdate", "lastmodifieddate"];
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let after: string | undefined;
  let page = 0;

  do {
    const response = await client.crm.deals.basicApi.getPage(
      BATCH_SIZE, after, hsProperties, undefined, undefined, false
    );

    const deals = response.results || [];

    for (const hsDeal of deals) {
      try {
        const hsId = hsDeal.id;
        const props = hsDeal.properties || {};

        const localData: Record<string, unknown> = {
          user_id: userId,
          org_id: orgId,
          metadata: {
            hubspot_id: hsId,
            hubspot_updated_at: props.lastmodifieddate,
            hubspot_pipeline: props.pipeline,
            hubspot_owner_id: props.hubspot_owner_id,
          },
        };

        for (const [hsProp, localField] of Object.entries(fieldMap)) {
          if (props[hsProp] !== undefined && props[hsProp] !== null) {
            if (localField === "value") {
              localData[localField] = Number(props[hsProp]) || 0;
            } else {
              localData[localField] = props[hsProp];
            }
          }
        }

        // Map deal stage
        if (props.dealstage) {
          const stageLower = props.dealstage.toLowerCase();
          localData.stage = DEFAULT_STAGE_MAP[stageLower] || "lead";
        }

        // Try to resolve associations via REST API
        try {
          const assocCompanyRes = await fetch(
            `https://api.hubapi.com/crm/v4/objects/deals/${hsId}/associations/companies`,
            { headers: { Authorization: `Bearer ${config.access_token}` } }
          );
          if (assocCompanyRes.ok) {
            const assocData = await assocCompanyRes.json();
            const companyHsId = assocData.results?.[0]?.toObjectId;
            if (companyHsId) {
              const { data: localCompany } = await supabase
                .from("crm_companies")
                .select("id")
                .eq("user_id", userId)
                .eq("metadata->>hubspot_id", String(companyHsId))
                .maybeSingle();
              if (localCompany) localData.company_id = localCompany.id;
            }
          }
        } catch { /* associations may not be available */ }

        try {
          const assocContactRes = await fetch(
            `https://api.hubapi.com/crm/v4/objects/deals/${hsId}/associations/contacts`,
            { headers: { Authorization: `Bearer ${config.access_token}` } }
          );
          if (assocContactRes.ok) {
            const assocData = await assocContactRes.json();
            const contactHsId = assocData.results?.[0]?.toObjectId;
            if (contactHsId) {
              const { data: localContact } = await supabase
                .from("crm_contacts")
                .select("id")
                .eq("user_id", userId)
                .eq("metadata->>hubspot_id", String(contactHsId))
                .maybeSingle();
              if (localContact) localData.contact_id = localContact.id;
            }
          }
        } catch { /* associations may not be available */ }

        // Dedup: check by hubspot_id
        const { data: byHsId } = await supabase
          .from("crm_deals")
          .select("id, updated_at")
          .eq("user_id", userId)
          .eq("metadata->>hubspot_id", hsId)
          .maybeSingle();

        if (byHsId) {
          const hsUpdated = props.lastmodifieddate ? new Date(props.lastmodifieddate).getTime() : 0;
          const localUpdated = new Date(byHsId.updated_at).getTime();
          if (hsUpdated > localUpdated) {
            const { metadata: _, user_id: __, ...updateFields } = localData;
            await supabase.from("crm_deals").update({
              ...updateFields,
              metadata: localData.metadata,
              updated_at: new Date().toISOString(),
            }).eq("id", byHsId.id);
            result.updated++;
          } else {
            result.skipped++;
          }
          continue;
        }

        // Insert new deal
        await supabase.from("crm_deals").insert(localData);
        result.created++;
      } catch (err) {
        console.error("Error importing deal:", err);
        result.errors++;
      }
    }

    after = response.paging?.next?.after;
    page++;

    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing deals: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (after);

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Deals import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);

  return result;
}

/* ── Export: Contacts (Local → HubSpot) ─────────────────── */

export async function exportContacts(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  lastSyncAt: string | null
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "contacts");
  const reversed = reverseMap(fieldMap);
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // Find contacts modified since last sync
  let query = supabase
    .from("crm_contacts")
    .select("*")
    .eq("user_id", userId);

  if (lastSyncAt) {
    query = query.gt("updated_at", lastSyncAt);
  }

  const { data: contacts } = await query;
  if (!contacts || contacts.length === 0) return result;

  for (const contact of contacts) {
    try {
      const meta = (contact.metadata || {}) as Record<string, unknown>;
      const hsId = meta.hubspot_id as string | undefined;

      // Build HubSpot properties from local fields
      const hsProps: Record<string, string> = {};
      for (const [localField, hsProp] of Object.entries(reversed)) {
        const val = contact[localField as keyof typeof contact];
        if (val !== undefined && val !== null && val !== "") {
          hsProps[hsProp] = String(val);
        }
      }

      if (hsId) {
        // Update existing HubSpot record
        await client.crm.contacts.basicApi.update(hsId, { properties: hsProps });
        result.updated++;
      } else {
        // Create new HubSpot record
        const created = await client.crm.contacts.basicApi.create({
          properties: hsProps,
          associations: [],
        });
        // Store the HubSpot ID back in local metadata
        await supabase.from("crm_contacts").update({
          metadata: { ...meta, hubspot_id: created.id, hubspot_updated_at: new Date().toISOString() },
        }).eq("id", contact.id);
        result.created++;
      }
    } catch (err) {
      console.error("Error exporting contact:", err);
      result.errors++;
    }
  }

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Contacts export done: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);

  return result;
}

/* ── Export: Companies (Local → HubSpot) ────────────────── */

export async function exportCompanies(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  lastSyncAt: string | null
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "companies");
  const reversed = reverseMap(fieldMap);
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let query = supabase
    .from("crm_companies")
    .select("*")
    .eq("user_id", userId);

  if (lastSyncAt) {
    query = query.gt("updated_at", lastSyncAt);
  }

  const { data: companies } = await query;
  if (!companies || companies.length === 0) return result;

  for (const company of companies) {
    try {
      const meta = (company.metadata || {}) as Record<string, unknown>;
      const hsId = meta.hubspot_id as string | undefined;

      const hsProps: Record<string, string> = {};
      for (const [localField, hsProp] of Object.entries(reversed)) {
        const val = company[localField as keyof typeof company];
        if (val !== undefined && val !== null && val !== "") {
          hsProps[hsProp] = String(val);
        }
      }

      if (hsId) {
        await client.crm.companies.basicApi.update(hsId, { properties: hsProps });
        result.updated++;
      } else {
        const created = await client.crm.companies.basicApi.create({
          properties: hsProps,
          associations: [],
        });
        await supabase.from("crm_companies").update({
          metadata: { ...meta, hubspot_id: created.id, hubspot_updated_at: new Date().toISOString() },
        }).eq("id", company.id);
        result.created++;
      }
    } catch (err) {
      console.error("Error exporting company:", err);
      result.errors++;
    }
  }

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Companies export done: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);

  return result;
}

/* ── Export: Deals (Local → HubSpot) ────────────────────── */

const REVERSE_STAGE_MAP: Record<string, string> = {
  lead: "appointmentscheduled",
  qualified: "qualifiedtobuy",
  proposal: "presentationscheduled",
  negotiation: "decisionmakerboughtin",
  won: "closedwon",
  lost: "closedlost",
};

export async function exportDeals(
  config: HubSpotConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  lastSyncAt: string | null
): Promise<SyncResult> {
  const client = getClient(config);
  const fieldMap = getFieldMap(config, "deals");
  const reversed = reverseMap(fieldMap);
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let query = supabase
    .from("crm_deals")
    .select("*")
    .eq("user_id", userId);

  if (lastSyncAt) {
    query = query.gt("updated_at", lastSyncAt);
  }

  const { data: deals } = await query;
  if (!deals || deals.length === 0) return result;

  for (const deal of deals) {
    try {
      const meta = (deal.metadata || {}) as Record<string, unknown>;
      const hsId = meta.hubspot_id as string | undefined;

      const hsProps: Record<string, string> = {};
      for (const [localField, hsProp] of Object.entries(reversed)) {
        const val = deal[localField as keyof typeof deal];
        if (val !== undefined && val !== null && val !== "") {
          hsProps[hsProp] = String(val);
        }
      }

      // Map stage back to HubSpot
      if (deal.stage) {
        const hsStage = REVERSE_STAGE_MAP[deal.stage];
        if (hsStage) hsProps.dealstage = hsStage;
      }

      if (hsId) {
        await client.crm.deals.basicApi.update(hsId, { properties: hsProps });
        result.updated++;
      } else {
        const created = await client.crm.deals.basicApi.create({
          properties: hsProps,
          associations: [],
        });
        await supabase.from("crm_deals").update({
          metadata: { ...meta, hubspot_id: created.id, hubspot_updated_at: new Date().toISOString() },
        }).eq("id", deal.id);
        result.created++;
      }
    } catch (err) {
      console.error("Error exporting deal:", err);
      result.errors++;
    }
  }

  await logSync(supabase, userId, orgId, connectorId, "info",
    `Deals export done: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);

  return result;
}
