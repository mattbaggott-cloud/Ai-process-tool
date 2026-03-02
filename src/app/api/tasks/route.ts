/**
 * Unified Tasks API — "Task Hub" across all task sources
 *
 * GET /api/tasks
 *   Returns paginated, unified tasks from both `tasks` and `campaign_tasks`.
 *   Query params:
 *     source       — "all" (default) | "task" | "campaign_task"
 *     assigned_to  — user ID, "me" (default → current user), or "all"
 *     status       — pending | in_progress | completed | cancelled | skipped
 *     task_type    — todo | reminder | follow_up | project_task | action_item
 *     priority     — low | medium | high | urgent
 *     campaign_id  — filter campaign_tasks to one campaign
 *     project_id   — filter tasks to one project
 *     due_before   — ISO date, tasks due before this date
 *     due_after    — ISO date, tasks due after this date
 *     page, limit  — pagination (default page=1, limit=50)
 *     sort         — due_at (default) | created_at
 *     order        — asc (default) | desc
 *
 * POST /api/tasks
 *   Create a general task (in the `tasks` table).
 *   Body: { title, description?, task_type?, priority?, due_at?,
 *           remind_at?, project_id?, contact_id?, company_id?,
 *           deal_id?, assigned_to?, tags? }
 *
 * PATCH /api/tasks
 *   Update a task (from either table).
 *   Body: { task_id, source: "task"|"campaign_task",
 *           action?: "start"|"complete"|"cancel",
 *           notes?, updates?: {...} }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import type { UnifiedTask, TaskPriority } from "@/lib/types/database";

/* ── GET: Unified task list ─────────────────────────────── */

export async function GET(request: Request) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "all";
  const assignedTo = url.searchParams.get("assigned_to") ?? "me";
  const status = url.searchParams.get("status");
  const taskType = url.searchParams.get("task_type");
  const priority = url.searchParams.get("priority");
  const campaignId = url.searchParams.get("campaign_id");
  const projectId = url.searchParams.get("project_id");
  const dueBefore = url.searchParams.get("due_before");
  const dueAfter = url.searchParams.get("due_after");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50"));
  const sort = url.searchParams.get("sort") ?? "due_at";
  const order = url.searchParams.get("order") ?? "asc";

  const ascending = order !== "desc";
  const resolvedAssignee = assignedTo === "me" ? orgCtx.user.id : assignedTo;

  const unified: UnifiedTask[] = [];

  // ── Fetch from `tasks` table ──
  if (source === "all" || source === "task") {
    let q = supabase
      .from("tasks")
      .select("*, projects(name), crm_contacts(first_name, last_name)")
      .eq("org_id", orgCtx.orgId);

    if (resolvedAssignee !== "all") q = q.eq("assigned_to", resolvedAssignee);
    if (status) q = q.eq("status", status);
    if (taskType) q = q.eq("task_type", taskType);
    if (priority) q = q.eq("priority", priority);
    if (projectId) q = q.eq("project_id", projectId);
    if (dueBefore) q = q.lte("due_at", dueBefore);
    if (dueAfter) q = q.gte("due_at", dueAfter);
    // Exclude cancelled by default when no status filter
    if (!status) q = q.neq("status", "cancelled");

    q = q.order(sort === "created_at" ? "created_at" : "due_at", { ascending, nullsFirst: false });
    q = q.limit(limit);

    const { data: tasks } = await q;
    for (const t of tasks ?? []) {
      const proj = t.projects as { name?: string } | null;
      const contact = t.crm_contacts as { first_name?: string; last_name?: string } | null;
      unified.push({
        id: t.id,
        source: "task",
        title: t.title,
        description: t.description,
        task_type: t.task_type,
        priority: t.priority as TaskPriority,
        status: t.status,
        assigned_to: t.assigned_to,
        due_at: t.due_at,
        completed_at: t.completed_at,
        tags: t.tags ?? [],
        project_name: proj?.name ?? null,
        campaign_name: null,
        contact_name: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null : null,
        created_at: t.created_at,
      });
    }
  }

  // ── Fetch from `campaign_tasks` table ──
  if (source === "all" || source === "campaign_task") {
    let q = supabase
      .from("campaign_tasks")
      .select("*, email_campaigns(id, name)")
      .eq("org_id", orgCtx.orgId);

    if (resolvedAssignee !== "all") q = q.eq("assigned_to", resolvedAssignee);
    if (status) q = q.eq("status", status);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    // Exclude skipped by default when no status filter
    if (!status) q = q.not("status", "in", "(skipped)");

    q = q.order(sort === "created_at" ? "created_at" : "due_at", { ascending, nullsFirst: false });
    q = q.limit(limit);

    const { data: ctasks } = await q;
    for (const ct of ctasks ?? []) {
      const camp = ct.email_campaigns as { id?: string; name?: string } | null;
      unified.push({
        id: ct.id,
        source: "campaign_task",
        title: ct.title || `Step ${ct.step_number}`,
        description: ct.instructions,
        task_type: ct.step_type ?? "auto_email",
        priority: null,
        status: ct.status,
        assigned_to: ct.assigned_to,
        due_at: ct.due_at,
        completed_at: ct.completed_at,
        tags: [],
        project_name: null,
        campaign_name: camp?.name ?? null,
        contact_name: ct.customer_name ?? ct.customer_email ?? null,
        created_at: ct.created_at,
      });
    }
  }

  // ── Sort merged results ──
  unified.sort((a, b) => {
    const field = sort === "created_at" ? "created_at" : "due_at";
    const aVal = a[field] ?? "";
    const bVal = b[field] ?? "";
    return ascending
      ? aVal.localeCompare(bVal)
      : bVal.localeCompare(aVal);
  });

  // ── Paginate merged results ──
  const offset = (page - 1) * limit;
  const paginated = unified.slice(offset, offset + limit);

  // ── Compute stats ──
  const stats = {
    total: unified.length,
    pending: unified.filter(t => t.status === "pending").length,
    in_progress: unified.filter(t => t.status === "in_progress").length,
    completed: unified.filter(t => t.status === "completed").length,
    overdue: unified.filter(t =>
      t.due_at && new Date(t.due_at) < new Date() &&
      (t.status === "pending" || t.status === "in_progress")
    ).length,
  };

  return NextResponse.json({
    tasks: paginated,
    total: unified.length,
    page,
    limit,
    stats,
  });
}

/* ── POST: Create a general task ────────────────────────── */

export async function POST(request: Request) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { title } = body;
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        org_id: orgCtx.orgId,
        created_by: orgCtx.user.id,
        title,
        description: body.description ?? null,
        task_type: body.task_type ?? "todo",
        priority: body.priority ?? "medium",
        project_id: body.project_id ?? null,
        contact_id: body.contact_id ?? null,
        company_id: body.company_id ?? null,
        deal_id: body.deal_id ?? null,
        assigned_to: body.assigned_to ?? orgCtx.user.id,
        due_at: body.due_at ?? null,
        remind_at: body.remind_at ?? null,
        tags: body.tags ?? [],
        metadata: body.metadata ?? {},
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ task: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

/* ── PATCH: Update a task (either table) ────────────────── */

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const { task_id, source, action, notes, updates } = body;
    if (!task_id) return NextResponse.json({ error: "task_id is required" }, { status: 400 });

    const table = source === "campaign_task" ? "campaign_tasks" : "tasks";
    const now = new Date().toISOString();

    if (action === "start") {
      const { error } = await supabase
        .from(table)
        .update({ status: "in_progress", updated_at: now })
        .eq("id", task_id)
        .eq("org_id", orgCtx.orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === "complete") {
      const updateData: Record<string, unknown> = {
        status: "completed",
        completed_at: now,
        completed_by: orgCtx.user.id,
        updated_at: now,
      };
      if (notes) updateData.notes = notes;
      const { error } = await supabase
        .from(table)
        .update(updateData)
        .eq("id", task_id)
        .eq("org_id", orgCtx.orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === "cancel") {
      const updateCol = table === "campaign_tasks" ? "skipped" : "cancelled";
      const updateData: Record<string, unknown> = {
        status: updateCol,
        updated_at: now,
      };
      if (notes) updateData.notes = notes;
      const { error } = await supabase
        .from(table)
        .update(updateData)
        .eq("id", task_id)
        .eq("org_id", orgCtx.orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (updates && typeof updates === "object") {
      // Generic field updates (only for `tasks` table)
      if (table !== "tasks") {
        return NextResponse.json({ error: "Field updates only supported for general tasks" }, { status: 400 });
      }
      const allowedFields = ["title", "description", "task_type", "priority", "due_at", "remind_at", "assigned_to", "tags", "notes"];
      const safeUpdates: Record<string, unknown> = { updated_at: now };
      for (const [k, v] of Object.entries(updates)) {
        if (allowedFields.includes(k)) safeUpdates[k] = v;
      }
      const { error } = await supabase
        .from("tasks")
        .update(safeUpdates)
        .eq("id", task_id)
        .eq("org_id", orgCtx.orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      return NextResponse.json({ error: "Provide action or updates" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
