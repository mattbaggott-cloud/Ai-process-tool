import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * GET /api/identity/resolve/candidates?run_id=xxx
 *
 * Returns individual match candidates for a specific resolution run.
 * Used by the review panel to show candidate details.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orgId } = orgCtx;
  const runId = req.nextUrl.searchParams.get("run_id");

  if (!runId) {
    return NextResponse.json({ error: "run_id is required" }, { status: 400 });
  }

  try {
    // Verify run belongs to this org
    const { data: run } = await supabase
      .from("identity_resolution_runs")
      .select("id, status")
      .eq("id", runId)
      .eq("org_id", orgId)
      .single();

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Load all candidates for this run (limited to 500 for UI performance)
    const { data: candidates, error } = await supabase
      .from("identity_match_candidates")
      .select("id, source_a_type, source_a_label, source_b_type, source_b_label, match_tier, confidence, match_signals, matched_on, needs_review, status")
      .eq("run_id", runId)
      .eq("org_id", orgId)
      .order("match_tier", { ascending: true })
      .order("confidence", { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      run_id: runId,
      run_status: run.status,
      candidates: candidates || [],
      total: candidates?.length ?? 0,
    });
  } catch (err) {
    console.error("Failed to load candidates:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load candidates" },
      { status: 500 }
    );
  }
}
