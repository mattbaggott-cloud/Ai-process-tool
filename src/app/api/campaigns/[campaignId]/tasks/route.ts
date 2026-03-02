/**
 * Campaign Tasks API
 *
 * GET   /api/campaigns/[campaignId]/tasks
 *   Returns paginated tasks for a campaign with customer + campaign context.
 *   Query params: status, step_type, assigned_to, page, limit
 *
 * PATCH /api/campaigns/[campaignId]/tasks
 *   Body: { taskId, action: 'start' | 'complete' | 'skip' | 'reassign', notes?, assignee? }
 *   Updates a task's status.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

type RouteParams = { params: Promise<{ campaignId: string }> };

/* ── GET ── */

export async function GET(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const stepType = url.searchParams.get("step_type");
  const assignedTo = url.searchParams.get("assigned_to");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50"));
  const offset = (page - 1) * limit;

  let query = supabase
    .from("campaign_tasks")
    .select("*, email_campaigns!inner(name, campaign_category)", { count: "exact" })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgCtx.orgId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("step_number", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (stepType) query = query.eq("step_type", stepType);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    tasks: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}

/* ── PATCH ── */

export async function PATCH(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const { taskId, action, notes, assignee } = body as {
    taskId: string;
    action: "start" | "complete" | "skip" | "reassign";
    notes?: string;
    assignee?: string;
  };

  if (!taskId || !action) {
    return NextResponse.json({ error: "taskId and action are required" }, { status: 400 });
  }

  // Verify task belongs to this campaign + org
  const { data: task, error: fetchErr } = await supabase
    .from("campaign_tasks")
    .select("id, status")
    .eq("id", taskId)
    .eq("campaign_id", campaignId)
    .eq("org_id", orgCtx.orgId)
    .single();

  if (fetchErr || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  switch (action) {
    case "start":
      updates.status = "in_progress";
      break;
    case "complete":
      updates.status = "completed";
      updates.completed_at = new Date().toISOString();
      updates.completed_by = orgCtx.user.id;
      if (notes) updates.notes = notes;
      break;
    case "skip":
      updates.status = "skipped";
      if (notes) updates.notes = notes;
      break;
    case "reassign":
      if (!assignee) {
        return NextResponse.json({ error: "assignee is required for reassign" }, { status: 400 });
      }
      updates.assigned_to = assignee;
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("campaign_tasks")
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true, task: updated });
}
