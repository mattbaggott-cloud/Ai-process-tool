/**
 * Universal Identity Resolver — Waterfall Matching Engine
 *
 * Resolves identity across ALL data sources using a confidence-scored
 * waterfall of matching strategies. Higher tiers match first; already-matched
 * pairs are skipped by lower tiers.
 *
 * Matching Tiers:
 *   1. Exact email match         (confidence: 0.99)
 *   2. Phone match               (confidence: 0.90)
 *   3. Name + company/org match  (confidence: 0.80)
 *   4. Name + email domain match (confidence: 0.75)
 *   5. Name + city match         (confidence: 0.70)
 *   6. Name-only match           (confidence: 0.50, flagged for common names)
 *
 * Staged flow: compute → review → apply → (optional) reverse
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGraphNode } from "@/lib/agentic/graph-sync";

/* ================================================================ */
/*  Types                                                            */
/* ================================================================ */

/** A record from any source with all matchable fields */
interface IdentityRecord {
  source: string;       // e.g. "crm_contacts", "ecom_customers", "klaviyo_profiles"
  id: string;           // row ID in that source table
  email: string;        // normalized email (lowercase, trimmed)
  emailDomain: string;  // e.g. "example.com"
  phone: string;        // normalized phone (digits only, last 10)
  firstName: string;    // normalized (lowercase, trimmed)
  lastName: string;     // normalized (lowercase, trimmed)
  company: string;      // normalized company/org name
  city: string;         // normalized city
  label: string;        // display name for graph node
  sublabel?: string;    // secondary info
  graphNodeId?: string; // set after ensuring graph node
}

/** A single match candidate produced by a waterfall tier */
export interface MatchCandidate {
  recordA: IdentityRecord;
  recordB: IdentityRecord;
  tier: number;
  confidence: number;
  signals: string[];
  matchedOn: string;
  needsReview: boolean;
}

/** Per-tier stats for reporting */
export interface TierStats {
  tier: number;
  label: string;
  count: number;
  needsReview: number;
}

/** Result of computing resolution (before apply) */
export interface ComputeResolutionResult {
  runId: string;
  totalRecordsScanned: number;
  uniqueEmails: number;
  totalCandidates: number;
  byTier: TierStats[];
  needsReviewCount: number;
  durationMs: number;
  candidates: MatchCandidate[];
  sources: Record<string, number>;
}

/** Result of applying accepted matches */
export interface ApplyResolutionResult {
  edgesCreated: number;
  edgesExisting: number;
  identityLinksCreated: number;
  graphNodesSynced: number;
  errors: number;
}

/** Legacy result interface (backwards compat) */
export interface IdentityResolutionResult {
  total_records_scanned: number;
  unique_emails: number;
  cross_source_matches: number;
  edges_created: number;
  edges_existing: number;
  identity_links_created: number;
  graph_nodes_synced: number;
  errors: number;
  sources: Record<string, number>;
  matches_by_tier?: Record<number, number>;
}

/* ================================================================ */
/*  Tier definitions                                                 */
/* ================================================================ */

const TIER_LABELS: Record<number, string> = {
  1: "Email match",
  2: "Phone match",
  3: "Name + company",
  4: "Name + email domain",
  5: "Name + city",
  6: "Name only",
};

const TIER_CONFIDENCE: Record<number, number> = {
  1: 0.99,
  2: 0.90,
  3: 0.80,
  4: 0.75,
  5: 0.70,
  6: 0.50,
};

/* ================================================================ */
/*  Normalization helpers                                            */
/* ================================================================ */

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  // Strip everything except digits
  const digits = raw.replace(/\D/g, "");
  // Take last 10 digits (handles country codes like +1, +44)
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function emailDomain(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

/** Create a sorted pair key to track already-matched pairs */
function pairKey(a: IdentityRecord, b: IdentityRecord): string {
  const keyA = `${a.source}:${a.id}`;
  const keyB = `${b.source}:${b.id}`;
  return keyA < keyB ? `${keyA}::${keyB}` : `${keyB}::${keyA}`;
}

/* ================================================================ */
/*  Source Definitions                                               */
/* ================================================================ */

interface SourceDef {
  table: string;
  entityType: string;
  selectColumns: string;
  extract: (row: Record<string, unknown>) => {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    company: string;
    city: string;
    label: string;
    sublabel?: string;
  };
}

const IDENTITY_SOURCES: SourceDef[] = [
  {
    table: "crm_contacts",
    entityType: "crm_contacts",
    selectColumns: "id, email, phone, first_name, last_name, title, status, company_id, crm_companies(name)",
    extract: (r) => {
      const first = norm(r.first_name as string);
      const last = norm(r.last_name as string);
      const company = r.crm_companies
        ? norm((r.crm_companies as { name: string }).name)
        : "";
      return {
        email: norm(r.email as string),
        phone: normalizePhone(r.phone as string),
        firstName: first,
        lastName: last,
        company,
        city: "", // CRM contacts don't have city
        label: `${(r.first_name as string) || ""} ${(r.last_name as string) || ""}`.trim() || (r.email as string) || "Unknown Contact",
        sublabel: (r.title as string) || (r.status as string) || undefined,
      };
    },
  },
  {
    table: "ecom_customers",
    entityType: "ecom_customers",
    selectColumns: "id, email, phone, first_name, last_name, total_spent, orders_count, default_address",
    extract: (r) => {
      const first = norm(r.first_name as string);
      const last = norm(r.last_name as string);
      // Extract city from default_address JSONB
      const addr = r.default_address as Record<string, unknown> | null;
      const city = addr ? norm(addr.city as string) : "";
      const spent = r.total_spent ? `$${r.total_spent}` : "";
      const orders = r.orders_count ? `${r.orders_count} orders` : "";
      return {
        email: norm(r.email as string),
        phone: normalizePhone(r.phone as string),
        firstName: first,
        lastName: last,
        company: "", // Ecom customers don't have company
        city,
        label: `${(r.first_name as string) || ""} ${(r.last_name as string) || ""}`.trim() || (r.email as string) || "Unknown Customer",
        sublabel: [spent, orders].filter(Boolean).join(" · ") || undefined,
      };
    },
  },
  {
    table: "klaviyo_profiles",
    entityType: "klaviyo_profiles",
    selectColumns: "id, email, phone_number, first_name, last_name, organization, title, city",
    extract: (r) => {
      const first = norm(r.first_name as string);
      const last = norm(r.last_name as string);
      return {
        email: norm(r.email as string),
        phone: normalizePhone(r.phone_number as string),
        firstName: first,
        lastName: last,
        company: norm(r.organization as string),
        city: norm(r.city as string),
        label: `${(r.first_name as string) || ""} ${(r.last_name as string) || ""}`.trim() || (r.email as string) || "Unknown Subscriber",
        sublabel: (r.organization as string) || "Klaviyo subscriber",
      };
    },
  },
];

/* ================================================================ */
/*  Waterfall Matchers                                               */
/* ================================================================ */

/** Tier 1: Exact email match */
function matchByEmail(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  const byEmail = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.email) continue;
    const existing = byEmail.get(r.email);
    if (existing) existing.push(r);
    else byEmail.set(r.email, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [email, group] of byEmail) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 1,
          confidence: TIER_CONFIDENCE[1],
          signals: ["email"],
          matchedOn: email,
          needsReview: false,
        });
      }
    }
  }
  return candidates;
}

/** Tier 2: Phone match */
function matchByPhone(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  const byPhone = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.phone || r.phone.length < 7) continue;
    const existing = byPhone.get(r.phone);
    if (existing) existing.push(r);
    else byPhone.set(r.phone, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [phone, group] of byPhone) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 2,
          confidence: TIER_CONFIDENCE[2],
          signals: ["phone"],
          matchedOn: phone,
          needsReview: false,
        });
      }
    }
  }
  return candidates;
}

/** Tier 3: First + Last name + Company */
function matchByNameCompany(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  const byKey = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.firstName || !r.lastName || !r.company) continue;
    const key = `${r.firstName}|${r.lastName}|${r.company}`;
    const existing = byKey.get(key);
    if (existing) existing.push(r);
    else byKey.set(key, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [key, group] of byKey) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 3,
          confidence: TIER_CONFIDENCE[3],
          signals: ["first_name", "last_name", "company"],
          matchedOn: key.replace(/\|/g, " + "),
          needsReview: false,
        });
      }
    }
  }
  return candidates;
}

/** Tier 4: First + Last name + Email domain */
function matchByNameEmailDomain(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  const byKey = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.firstName || !r.lastName || !r.emailDomain) continue;
    const key = `${r.firstName}|${r.lastName}|${r.emailDomain}`;
    const existing = byKey.get(key);
    if (existing) existing.push(r);
    else byKey.set(key, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [key, group] of byKey) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 4,
          confidence: TIER_CONFIDENCE[4],
          signals: ["first_name", "last_name", "email_domain"],
          matchedOn: key.replace(/\|/g, " + "),
          needsReview: false,
        });
      }
    }
  }
  return candidates;
}

/** Tier 5: First + Last name + City */
function matchByNameCity(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  const byKey = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.firstName || !r.lastName || !r.city) continue;
    const key = `${r.firstName}|${r.lastName}|${r.city}`;
    const existing = byKey.get(key);
    if (existing) existing.push(r);
    else byKey.set(key, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [key, group] of byKey) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 5,
          confidence: TIER_CONFIDENCE[5],
          signals: ["first_name", "last_name", "city"],
          matchedOn: key.replace(/\|/g, " + "),
          needsReview: false,
        });
      }
    }
  }
  return candidates;
}

/** Tier 6: First + Last name only (flag common names for review) */
function matchByNameOnly(records: IdentityRecord[], matchedPairs: Set<string>): MatchCandidate[] {
  // Count name frequency across all records to detect common names
  const nameCount = new Map<string, number>();
  for (const r of records) {
    if (!r.firstName || !r.lastName) continue;
    const key = `${r.firstName}|${r.lastName}`;
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }

  const byKey = new Map<string, IdentityRecord[]>();
  for (const r of records) {
    if (!r.firstName || !r.lastName) continue;
    const key = `${r.firstName}|${r.lastName}`;
    const existing = byKey.get(key);
    if (existing) existing.push(r);
    else byKey.set(key, [r]);
  }

  const candidates: MatchCandidate[] = [];
  for (const [key, group] of byKey) {
    const isCommonName = (nameCount.get(key) || 0) >= 3;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].source === group[j].source) continue;
        const pk = pairKey(group[i], group[j]);
        if (matchedPairs.has(pk)) continue;
        matchedPairs.add(pk);
        candidates.push({
          recordA: group[i],
          recordB: group[j],
          tier: 6,
          confidence: TIER_CONFIDENCE[6],
          signals: ["first_name", "last_name"],
          matchedOn: key.replace(/\|/g, " "),
          needsReview: isCommonName,
        });
      }
    }
  }
  return candidates;
}

/* ================================================================ */
/*  Step 1: COMPUTE — run waterfall, store candidates                */
/* ================================================================ */

export async function computeResolution(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string
): Promise<ComputeResolutionResult> {
  const startTime = Date.now();
  const sourceCounts: Record<string, number> = {};

  // ── Collect all records from all sources ──
  const allRecords: IdentityRecord[] = [];

  for (const source of IDENTITY_SOURCES) {
    try {
      const { data: rows, error } = await supabase
        .from(source.table)
        .select(source.selectColumns)
        .eq("org_id", orgId)
        .not("email", "is", null)
        .neq("email", "");

      if (error) {
        if (error.code === "42P01" || error.message?.includes("does not exist")) continue;
        console.error(`Identity resolver: error reading ${source.table}:`, error.message);
        continue;
      }

      const records = rows ?? [];
      sourceCounts[source.table] = records.length;

      for (const row of records) {
        const r = row as unknown as Record<string, unknown>;
        const extracted = source.extract(r);
        if (!extracted.email) continue;

        allRecords.push({
          source: source.entityType,
          id: r.id as string,
          email: extracted.email,
          emailDomain: emailDomain(extracted.email),
          phone: extracted.phone,
          firstName: extracted.firstName,
          lastName: extracted.lastName,
          company: extracted.company,
          city: extracted.city,
          label: extracted.label,
          sublabel: extracted.sublabel,
        });
      }
    } catch (err) {
      console.error(`Identity resolver: failed to load ${source.table}:`, err);
    }
  }

  // Also load records that might only have phone (no email) for phone matching
  for (const source of IDENTITY_SOURCES) {
    try {
      // Get records with phone but no email (that we didn't already load)
      const phoneColumn = source.table === "klaviyo_profiles" ? "phone_number" : "phone";
      const { data: phoneRows, error } = await supabase
        .from(source.table)
        .select(source.selectColumns)
        .eq("org_id", orgId)
        .or(`email.is.null,email.eq.`)
        .not(phoneColumn, "is", null)
        .neq(phoneColumn, "");

      if (error || !phoneRows) continue;

      for (const row of phoneRows) {
        const r = row as unknown as Record<string, unknown>;
        const extracted = source.extract(r);
        if (!extracted.phone) continue;
        // Skip if we already have this record (loaded via email query)
        if (allRecords.some((rec) => rec.source === source.entityType && rec.id === (r.id as string))) continue;

        allRecords.push({
          source: source.entityType,
          id: r.id as string,
          email: extracted.email,
          emailDomain: emailDomain(extracted.email),
          phone: extracted.phone,
          firstName: extracted.firstName,
          lastName: extracted.lastName,
          company: extracted.company,
          city: extracted.city,
          label: extracted.label,
          sublabel: extracted.sublabel,
        });
        sourceCounts[source.table] = (sourceCounts[source.table] || 0) + 1;
      }
    } catch {
      // Non-fatal
    }
  }

  const uniqueEmails = new Set(allRecords.filter((r) => r.email).map((r) => r.email)).size;
  const totalScanned = allRecords.length;

  // ── Run waterfall matchers ──
  const matchedPairs = new Set<string>();
  const allCandidates: MatchCandidate[] = [];

  const tierResults = [
    matchByEmail(allRecords, matchedPairs),
    matchByPhone(allRecords, matchedPairs),
    matchByNameCompany(allRecords, matchedPairs),
    matchByNameEmailDomain(allRecords, matchedPairs),
    matchByNameCity(allRecords, matchedPairs),
    matchByNameOnly(allRecords, matchedPairs),
  ];

  for (const tierCandidates of tierResults) {
    allCandidates.push(...tierCandidates);
  }

  // ── Build tier stats ──
  const byTier: TierStats[] = [];
  for (let tier = 1; tier <= 6; tier++) {
    const tierCands = allCandidates.filter((c) => c.tier === tier);
    if (tierCands.length > 0) {
      byTier.push({
        tier,
        label: TIER_LABELS[tier],
        count: tierCands.length,
        needsReview: tierCands.filter((c) => c.needsReview).length,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  // ── Store in staging tables ──
  const { data: runData, error: runError } = await supabase
    .from("identity_resolution_runs")
    .insert({
      org_id: orgId,
      status: "pending_review",
      computed_at: new Date().toISOString(),
      stats: {
        total_records_scanned: totalScanned,
        unique_emails: uniqueEmails,
        total_candidates: allCandidates.length,
        by_tier: Object.fromEntries(byTier.map((t) => [t.tier, t.count])),
        needs_review: allCandidates.filter((c) => c.needsReview).length,
        duration_ms: durationMs,
        sources: sourceCounts,
      },
      created_by: userId || null,
    })
    .select("id")
    .single();

  if (runError || !runData) {
    throw new Error(`Failed to create resolution run: ${runError?.message || "unknown"}`);
  }

  const runId = runData.id as string;

  // Insert candidates in batches (Supabase limit is ~1000 per insert)
  const BATCH_SIZE = 500;
  for (let i = 0; i < allCandidates.length; i += BATCH_SIZE) {
    const batch = allCandidates.slice(i, i + BATCH_SIZE).map((c) => ({
      run_id: runId,
      org_id: orgId,
      source_a_type: c.recordA.source,
      source_a_id: c.recordA.id,
      source_a_label: c.recordA.label,
      source_b_type: c.recordB.source,
      source_b_id: c.recordB.id,
      source_b_label: c.recordB.label,
      match_tier: c.tier,
      confidence: c.confidence,
      match_signals: c.signals,
      matched_on: c.matchedOn,
      needs_review: c.needsReview,
      status: "pending",
    }));

    const { error: batchError } = await supabase
      .from("identity_match_candidates")
      .insert(batch);

    if (batchError) {
      console.error("Error inserting match candidates batch:", batchError.message);
    }
  }

  return {
    runId,
    totalRecordsScanned: totalScanned,
    uniqueEmails,
    totalCandidates: allCandidates.length,
    byTier,
    needsReviewCount: allCandidates.filter((c) => c.needsReview).length,
    durationMs,
    candidates: allCandidates,
    sources: sourceCounts,
  };
}

/* ================================================================ */
/*  Step 2: APPLY — create real graph edges for accepted candidates  */
/* ================================================================ */

/**
 * Apply accepted match candidates from a resolution run.
 * If acceptedIds is provided, only those candidates are applied.
 * If acceptedIds is null/undefined, all non-rejected candidates are applied.
 */
export async function applyResolution(
  supabase: SupabaseClient,
  orgId: string,
  runId: string,
  userId?: string,
  acceptedIds?: string[]
): Promise<ApplyResolutionResult> {
  const result: ApplyResolutionResult = {
    edgesCreated: 0,
    edgesExisting: 0,
    identityLinksCreated: 0,
    graphNodesSynced: 0,
    errors: 0,
  };

  // Load candidates to apply
  let query = supabase
    .from("identity_match_candidates")
    .select("*")
    .eq("run_id", runId)
    .eq("org_id", orgId);

  if (acceptedIds && acceptedIds.length > 0) {
    // Apply only explicitly accepted candidates
    query = query.in("id", acceptedIds);
  } else {
    // Apply all non-rejected candidates
    query = query.neq("status", "rejected");
  }

  const { data: candidates, error } = await query;
  if (error || !candidates) {
    throw new Error(`Failed to load candidates: ${error?.message || "no data"}`);
  }

  // Mark selected candidates as accepted
  if (acceptedIds && acceptedIds.length > 0) {
    await supabase
      .from("identity_match_candidates")
      .update({ status: "accepted" })
      .in("id", acceptedIds)
      .eq("run_id", runId);
  } else {
    // Mark all pending as accepted
    await supabase
      .from("identity_match_candidates")
      .update({ status: "accepted" })
      .eq("run_id", runId)
      .eq("status", "pending");
  }

  // Create graph edges for each accepted candidate
  for (const c of candidates) {
    const candidate = c as Record<string, unknown>;
    try {
      // Ensure graph nodes exist for both records
      const nodeAId = await ensureGraphNode(
        supabase,
        orgId,
        candidate.source_a_type as string,
        candidate.source_a_id as string,
        candidate.source_a_label as string,
        null,
        userId
      );
      if (nodeAId) result.graphNodesSynced++;

      const nodeBId = await ensureGraphNode(
        supabase,
        orgId,
        candidate.source_b_type as string,
        candidate.source_b_id as string,
        candidate.source_b_label as string,
        null,
        userId
      );
      if (nodeBId) result.graphNodesSynced++;

      if (!nodeAId || !nodeBId) {
        result.errors++;
        continue;
      }

      // Check for existing edge
      const { data: existingEdge } = await supabase
        .from("graph_edges")
        .select("id")
        .eq("org_id", orgId)
        .eq("source_node_id", nodeAId)
        .eq("target_node_id", nodeBId)
        .eq("relation_type", "same_person")
        .is("valid_until", null)
        .maybeSingle();

      if (existingEdge) {
        result.edgesExisting++;
        // Update the candidate with the existing edge ID
        await supabase
          .from("identity_match_candidates")
          .update({ graph_edge_id: existingEdge.id })
          .eq("id", candidate.id as string);
        continue;
      }

      // Create the graph edge with confidence and provenance
      const { data: edgeData, error: edgeError } = await supabase
        .from("graph_edges")
        .insert({
          org_id: orgId,
          source_node_id: nodeAId,
          target_node_id: nodeBId,
          relation_type: "same_person",
          weight: candidate.confidence as number,
          confidence: candidate.confidence as number,
          properties: {
            run_id: runId,
            match_tier: candidate.match_tier,
            match_signals: candidate.match_signals,
            matched_on: candidate.matched_on,
          },
          source: "system",
          valid_from: new Date().toISOString(),
          created_by: userId || null,
        })
        .select("id")
        .single();

      if (edgeError) {
        // Likely duplicate race condition
        result.edgesExisting++;
      } else if (edgeData) {
        result.edgesCreated++;
        // Link candidate to the created edge
        await supabase
          .from("identity_match_candidates")
          .update({ graph_edge_id: edgeData.id })
          .eq("id", candidate.id as string);
      }

      // ── Legacy customer_identity_links for CRM↔ecom ──
      const sourceAType = candidate.source_a_type as string;
      const sourceBType = candidate.source_b_type as string;
      if (
        (sourceAType === "crm_contacts" && sourceBType === "ecom_customers") ||
        (sourceAType === "ecom_customers" && sourceBType === "crm_contacts")
      ) {
        const crmId = sourceAType === "crm_contacts" ? candidate.source_a_id : candidate.source_b_id;
        const ecomId = sourceAType === "ecom_customers" ? candidate.source_a_id : candidate.source_b_id;
        const matchTier = candidate.match_tier as number;
        const matchTypeMap: Record<number, string> = {
          1: "email_exact",
          2: "phone_match",
          3: "name_company",
          4: "name_email_domain",
          5: "name_city",
          6: "name_only",
        };

        try {
          const { error: linkError } = await supabase
            .from("customer_identity_links")
            .upsert(
              {
                org_id: orgId,
                crm_contact_id: crmId,
                ecom_customer_id: ecomId,
                match_type: matchTypeMap[matchTier] || "email_exact",
                confidence: candidate.confidence as number,
                matched_on: candidate.matched_on as string,
                is_active: true,
                linked_by: userId || null,
              },
              { onConflict: "org_id,crm_contact_id,ecom_customer_id", ignoreDuplicates: true }
            );

          if (!linkError) result.identityLinksCreated++;
        } catch {
          // Non-fatal duplicate
        }
      }
    } catch (err) {
      console.error("Error applying match candidate:", err);
      result.errors++;
    }
  }

  // Update run status
  const appliedCount = candidates.length;
  const { data: totalCount } = await supabase
    .from("identity_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);

  const hasRejected = await supabase
    .from("identity_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "rejected");

  const rejectedCount = hasRejected.count ?? 0;
  const totalCandidates = totalCount ? (totalCount as unknown as { count: number }).count || candidates.length : candidates.length;

  const newStatus = rejectedCount > 0 && appliedCount < totalCandidates
    ? "partially_applied"
    : "applied";

  await supabase
    .from("identity_resolution_runs")
    .update({
      status: newStatus,
      applied_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return result;
}

/* ================================================================ */
/*  Step 3: REVERSE — undo a resolution run                          */
/* ================================================================ */

export async function reverseResolution(
  supabase: SupabaseClient,
  orgId: string,
  runId: string
): Promise<{ edgesDeactivated: number; linksDeactivated: number }> {
  let edgesDeactivated = 0;
  let linksDeactivated = 0;

  // Load all accepted candidates with graph edges
  const { data: candidates } = await supabase
    .from("identity_match_candidates")
    .select("id, graph_edge_id, source_a_type, source_a_id, source_b_type, source_b_id")
    .eq("run_id", runId)
    .eq("status", "accepted")
    .not("graph_edge_id", "is", null);

  if (candidates) {
    for (const c of candidates) {
      const candidate = c as Record<string, unknown>;
      // Soft-delete the graph edge (set valid_until)
      if (candidate.graph_edge_id) {
        const { error } = await supabase
          .from("graph_edges")
          .update({ valid_until: new Date().toISOString() })
          .eq("id", candidate.graph_edge_id as string)
          .eq("org_id", orgId);

        if (!error) edgesDeactivated++;
      }

      // Deactivate legacy identity links for CRM↔ecom pairs
      const sourceAType = candidate.source_a_type as string;
      const sourceBType = candidate.source_b_type as string;
      if (
        (sourceAType === "crm_contacts" && sourceBType === "ecom_customers") ||
        (sourceAType === "ecom_customers" && sourceBType === "crm_contacts")
      ) {
        const crmId = sourceAType === "crm_contacts" ? candidate.source_a_id : candidate.source_b_id;
        const ecomId = sourceAType === "ecom_customers" ? candidate.source_a_id : candidate.source_b_id;

        const { error } = await supabase
          .from("customer_identity_links")
          .update({ is_active: false })
          .eq("org_id", orgId)
          .eq("crm_contact_id", crmId as string)
          .eq("ecom_customer_id", ecomId as string);

        if (!error) linksDeactivated++;
      }
    }
  }

  // Update run status
  await supabase
    .from("identity_resolution_runs")
    .update({
      status: "reversed",
      reversed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  // Reset candidate statuses
  await supabase
    .from("identity_match_candidates")
    .update({ status: "pending", graph_edge_id: null })
    .eq("run_id", runId)
    .eq("status", "accepted");

  return { edgesDeactivated, linksDeactivated };
}

/* ================================================================ */
/*  Legacy wrapper — backwards compatibility                         */
/* ================================================================ */

/**
 * Run universal identity resolution (compute + auto-apply all).
 * Backwards-compatible wrapper for the old one-shot API.
 */
export async function resolveIdentities(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string
): Promise<IdentityResolutionResult> {
  const computed = await computeResolution(supabase, orgId, userId);
  const applied = await applyResolution(supabase, orgId, computed.runId, userId);

  return {
    total_records_scanned: computed.totalRecordsScanned,
    unique_emails: computed.uniqueEmails,
    cross_source_matches: computed.totalCandidates,
    edges_created: applied.edgesCreated,
    edges_existing: applied.edgesExisting,
    identity_links_created: applied.identityLinksCreated,
    graph_nodes_synced: applied.graphNodesSynced,
    errors: applied.errors,
    sources: computed.sources,
    matches_by_tier: Object.fromEntries(computed.byTier.map((t) => [t.tier, t.count])),
  };
}

/* ================================================================ */
/*  Summary for System Prompt / Chat Context                         */
/* ================================================================ */

export async function getIdentityResolutionSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  total_unified_people: number;
  cross_source_linked: number;
  sources_active: string[];
  crm_contacts: number;
  ecom_customers: number;
  klaviyo_profiles: number;
} | null> {
  try {
    const counts = await Promise.all([
      supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("ecom_customers").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("klaviyo_profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId).then(
        (r) => r,
        () => ({ count: 0, data: null, error: null })
      ),
    ]);

    const crmCount = counts[0].count ?? 0;
    const ecomCount = counts[1].count ?? 0;
    const klaviyoCount = (counts[2] as { count: number | null }).count ?? 0;

    const { count: edgeCount } = await supabase
      .from("graph_edges")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("relation_type", "same_person")
      .is("valid_until", null);

    const sources: string[] = [];
    if (crmCount > 0) sources.push("CRM");
    if (ecomCount > 0) sources.push("Shopify");
    if (klaviyoCount > 0) sources.push("Klaviyo");

    const totalRecords = crmCount + ecomCount + klaviyoCount;
    const linkedEdges = edgeCount ?? 0;
    const totalUnified = Math.max(totalRecords - linkedEdges, 0);

    return {
      total_unified_people: totalUnified,
      cross_source_linked: linkedEdges,
      sources_active: sources,
      crm_contacts: crmCount,
      ecom_customers: ecomCount,
      klaviyo_profiles: klaviyoCount,
    };
  } catch {
    return null;
  }
}
