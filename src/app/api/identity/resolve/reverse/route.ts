import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { reverseResolution } from "@/lib/identity/resolver";

export const dynamic = "force-dynamic";

/**
 * POST /api/identity/resolve/reverse
 *
 * Reverse (undo) a previously applied identity resolution run.
 * Soft-deletes graph edges and deactivates identity links.
 *
 * Body:
 *   { run_id: string }
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

    if (!runId) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }

    // Verify the run belongs to this org and is applied
    const { data: run } = await supabase
      .from("identity_resolution_runs")
      .select("id, status")
      .eq("id", runId)
      .eq("org_id", orgId)
      .single();

    if (!run) {
      return NextResponse.json({ error: "Resolution run not found" }, { status: 404 });
    }

    if (run.status !== "applied" && run.status !== "partially_applied") {
      return NextResponse.json(
        { error: `Run is ${run.status}. Only applied runs can be reversed.` },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const result = await reverseResolution(supabase, orgId, runId);
    const durationMs = Date.now() - startTime;

    // Log the reversal
    try {
      await supabase.from("sync_logs").insert({
        user_id: user.id,
        org_id: orgId,
        connector_id: null,
        level: "info",
        message: `Identity resolution reversed in ${durationMs}ms: ` +
          `${result.edgesDeactivated} edges deactivated, ${result.linksDeactivated} links deactivated`,
        details: {
          action: "identity_resolution_reverse",
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
      edges_deactivated: result.edgesDeactivated,
      links_deactivated: result.linksDeactivated,
    });
  } catch (err) {
    console.error("Identity resolution reverse failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reverse failed" },
      { status: 500 }
    );
  }
}
