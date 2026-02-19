import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { applyResolution } from "@/lib/identity/resolver";

export const dynamic = "force-dynamic";

/**
 * POST /api/identity/resolve/apply
 *
 * Apply accepted identity resolution candidates from a run.
 * This is step 2 of the staged flow: compute → review → apply.
 *
 * Creates real graph edges and customer_identity_links for accepted matches.
 *
 * Body:
 *   { run_id: string, accepted_ids?: string[] }
 *
 * If accepted_ids is provided, only those candidates are applied.
 * If omitted, all non-rejected candidates from the run are applied.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { user, orgId } = orgCtx;

  try {
    const body = await req.json();
    const runId = body.run_id as string;
    const acceptedIds = body.accepted_ids as string[] | undefined;
    const rejectedIds = body.rejected_ids as string[] | undefined;

    if (!runId) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }

    // Verify the run belongs to this org and is in pending_review status
    const { data: run } = await supabase
      .from("identity_resolution_runs")
      .select("id, status")
      .eq("id", runId)
      .eq("org_id", orgId)
      .single();

    if (!run) {
      return NextResponse.json({ error: "Resolution run not found" }, { status: 404 });
    }

    if (run.status !== "pending_review") {
      return NextResponse.json(
        { error: `Run is already ${run.status}. Only pending_review runs can be applied.` },
        { status: 400 }
      );
    }

    // Mark rejected candidates first (if any)
    if (rejectedIds && rejectedIds.length > 0) {
      await supabase
        .from("identity_match_candidates")
        .update({ status: "rejected" })
        .in("id", rejectedIds)
        .eq("run_id", runId);
    }

    const startTime = Date.now();
    const result = await applyResolution(supabase, orgId, runId, user.id, acceptedIds);
    const durationMs = Date.now() - startTime;

    // Log the apply action for metering
    try {
      await supabase.from("sync_logs").insert({
        user_id: user.id,
        org_id: orgId,
        connector_id: null,
        level: result.errors > 0 ? "warning" : "success",
        message: `Identity resolution applied in ${durationMs}ms: ` +
          `${result.edgesCreated} edges created, ${result.edgesExisting} already existed`,
        details: {
          action: "identity_resolution_apply",
          duration_ms: durationMs,
          run_id: runId,
          ...result,
        },
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      run_id: runId,
      duration_ms: durationMs,
      edges_created: result.edgesCreated,
      edges_existing: result.edgesExisting,
      identity_links_created: result.identityLinksCreated,
      graph_nodes_synced: result.graphNodesSynced,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Identity resolution apply failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Apply failed" },
      { status: 500 }
    );
  }
}
