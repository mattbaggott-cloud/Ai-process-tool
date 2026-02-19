import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { computeResolution } from "@/lib/identity/resolver";

export const dynamic = "force-dynamic";

/**
 * POST /api/identity/resolve
 *
 * Compute identity resolution candidates using the waterfall engine.
 * This is step 1 of the staged flow: compute → review → apply.
 *
 * Runs all matching tiers, stores candidates in staging tables,
 * and returns the results for human review. No graph edges are
 * created at this point.
 */
export async function POST() {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { user, orgId } = orgCtx;

  try {
    const result = await computeResolution(supabase, orgId, user.id);

    // Log the resolution compute for usage tracking
    try {
      await supabase.from("sync_logs").insert({
        user_id: user.id,
        org_id: orgId,
        connector_id: null,
        level: "info",
        message: `Identity resolution computed in ${result.durationMs}ms: ` +
          `${result.totalRecordsScanned} records scanned, ` +
          `${result.totalCandidates} candidates found across ${result.byTier.length} tiers`,
        details: {
          action: "identity_resolution_compute",
          duration_ms: result.durationMs,
          run_id: result.runId,
          total_records_scanned: result.totalRecordsScanned,
          total_candidates: result.totalCandidates,
          by_tier: Object.fromEntries(result.byTier.map((t) => [t.tier, t.count])),
          needs_review: result.needsReviewCount,
        },
      });
    } catch {
      // Logging failure is non-fatal
    }

    return NextResponse.json({
      success: true,
      run_id: result.runId,
      total_records_scanned: result.totalRecordsScanned,
      unique_emails: result.uniqueEmails,
      total_candidates: result.totalCandidates,
      by_tier: result.byTier,
      needs_review_count: result.needsReviewCount,
      duration_ms: result.durationMs,
      sources: result.sources,
    });
  } catch (err) {
    console.error("Identity resolution compute failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Identity resolution failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/identity/resolve
 *
 * Returns identity resolution summary (current state, no mutations).
 * Also includes the latest pending_review run if one exists.
 */
export async function GET() {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orgId } = orgCtx;

  try {
    // Count records per source
    const [crmRes, ecomRes, klaviyoRes, edgesRes] = await Promise.all([
      supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("ecom_customers").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("klaviyo_profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId)
        .then((r) => r, () => ({ count: 0, data: null, error: null })),
      supabase.from("graph_edges").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).eq("relation_type", "same_person").is("valid_until", null),
    ]);

    const crmCount = crmRes.count ?? 0;
    const ecomCount = ecomRes.count ?? 0;
    const klaviyoCount = (klaviyoRes as { count: number | null }).count ?? 0;
    const edgeCount = edgesRes.count ?? 0;

    const sources: string[] = [];
    if (crmCount > 0) sources.push("hubspot");
    if (ecomCount > 0) sources.push("shopify");
    if (klaviyoCount > 0) sources.push("klaviyo");

    // Check for latest pending review run
    const { data: pendingRun } = await supabase
      .from("identity_resolution_runs")
      .select("id, status, computed_at, stats")
      .eq("org_id", orgId)
      .eq("status", "pending_review")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get recent runs for history
    const { data: recentRuns } = await supabase
      .from("identity_resolution_runs")
      .select("id, status, computed_at, applied_at, reversed_at, stats")
      .eq("org_id", orgId)
      .order("computed_at", { ascending: false })
      .limit(5);

    return NextResponse.json({
      sources,
      crm_contacts: crmCount,
      ecom_customers: ecomCount,
      klaviyo_profiles: klaviyoCount,
      total_records: crmCount + ecomCount + klaviyoCount,
      identity_edges: edgeCount,
      estimated_unique_people: Math.max(crmCount + ecomCount + klaviyoCount - edgeCount, 0),
      pending_run: pendingRun || null,
      recent_runs: recentRuns || [],
    });
  } catch (err) {
    console.error("Identity stats failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load identity stats" },
      { status: 500 }
    );
  }
}
