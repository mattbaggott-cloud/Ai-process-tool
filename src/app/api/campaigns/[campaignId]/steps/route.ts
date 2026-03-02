/**
 * Campaign Steps API — CRUD for sequence_steps within strategy groups
 *
 * GET    /api/campaigns/[campaignId]/steps
 *   Returns all steps grouped by strategy group.
 *
 * POST   /api/campaigns/[campaignId]/steps
 *   Body: { groupId, step: StrategySequenceStep, afterStepNumber?: number }
 *   Inserts a new step after the given position (or at end).
 *
 * PUT    /api/campaigns/[campaignId]/steps
 *   Body: { groupId, steps: StrategySequenceStep[] }
 *   Replaces all steps for a group (used for reorder + bulk save).
 *
 * PATCH  /api/campaigns/[campaignId]/steps
 *   Body: { groupId, stepNumber, updates: Partial<StrategySequenceStep> }
 *   Updates a single step within the group.
 *
 * DELETE /api/campaigns/[campaignId]/steps
 *   Body: { groupId, stepNumber }
 *   Removes a step and renumbers the remaining.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StrategySequenceStep } from "@/lib/types/database";

type RouteParams = { params: Promise<{ campaignId: string }> };

/* ── Helpers ── */

async function loadGroup(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string,
  groupId: string,
) {
  const { data, error } = await supabase
    .from("campaign_strategy_groups")
    .select("id, sequence_steps, updated_at")
    .eq("id", groupId)
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .single();
  if (error || !data) return null;
  return data as { id: string; sequence_steps: StrategySequenceStep[]; updated_at: string };
}

async function saveSteps(
  supabase: SupabaseClient,
  groupId: string,
  steps: StrategySequenceStep[],
) {
  // Renumber contiguously
  const renumbered = steps.map((s, i) => ({ ...s, step_number: i + 1 }));
  const { data, error } = await supabase
    .from("campaign_strategy_groups")
    .update({
      sequence_steps: renumbered,
      total_emails: renumbered.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .select("sequence_steps")
    .single();
  if (error) throw error;
  return (data as { sequence_steps: StrategySequenceStep[] }).sequence_steps;
}

async function checkVariantsExist(
  supabase: SupabaseClient,
  campaignId: string,
) {
  const { count } = await supabase
    .from("email_customer_variants")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return (count ?? 0) > 0;
}

/* ── GET ── */

export async function GET(_request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;

  const { data: groups, error } = await supabase
    .from("campaign_strategy_groups")
    .select("id, group_name, group_description, ai_reasoning, customer_count, sequence_steps, sort_order, status")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgCtx.orgId)
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    groups: (groups ?? []).map((g) => ({
      id: g.id,
      name: g.group_name,
      description: g.group_description,
      aiReasoning: g.ai_reasoning,
      customerCount: g.customer_count,
      steps: (g.sequence_steps as StrategySequenceStep[]) ?? [],
      sortOrder: g.sort_order,
      status: g.status,
    })),
  });
}

/* ── POST (add step) ── */

export async function POST(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const { groupId, step, afterStepNumber } = body as {
    groupId: string;
    step: Partial<StrategySequenceStep>;
    afterStepNumber?: number;
  };

  if (!groupId || !step) {
    return NextResponse.json({ error: "groupId and step are required" }, { status: 400 });
  }

  const group = await loadGroup(supabase, orgCtx.orgId, campaignId, groupId);
  if (!group) return NextResponse.json({ error: "Strategy group not found" }, { status: 404 });

  const steps = [...(group.sequence_steps ?? [])];
  const newStep: StrategySequenceStep = {
    step_number: 0, // will be renumbered
    delay_days: step.delay_days ?? 1,
    email_type: step.email_type ?? "follow_up",
    prompt: step.prompt ?? "",
    subject_hint: step.subject_hint,
    step_type: step.step_type ?? "auto_email",
    channel: step.channel,
    task_instructions: step.task_instructions,
  };

  if (afterStepNumber !== undefined && afterStepNumber > 0) {
    const idx = steps.findIndex((s) => s.step_number === afterStepNumber);
    steps.splice(idx + 1, 0, newStep);
  } else {
    steps.push(newStep);
  }

  try {
    const saved = await saveSteps(supabase, groupId, steps);
    return NextResponse.json({ success: true, steps: saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── PUT (replace all steps / reorder) ── */

export async function PUT(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const { groupId, steps } = body as {
    groupId: string;
    steps: StrategySequenceStep[];
  };

  if (!groupId || !Array.isArray(steps)) {
    return NextResponse.json({ error: "groupId and steps array are required" }, { status: 400 });
  }

  // If variants exist, warn about reorder
  const hasVariants = await checkVariantsExist(supabase, campaignId);
  if (hasVariants) {
    return NextResponse.json(
      { error: "Cannot reorder steps after variants have been generated. Delete variants first or create a new campaign." },
      { status: 409 },
    );
  }

  const group = await loadGroup(supabase, orgCtx.orgId, campaignId, groupId);
  if (!group) return NextResponse.json({ error: "Strategy group not found" }, { status: 404 });

  try {
    const saved = await saveSteps(supabase, groupId, steps);
    return NextResponse.json({ success: true, steps: saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── PATCH (update single step) ── */

export async function PATCH(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const { groupId, stepNumber, updates } = body as {
    groupId: string;
    stepNumber: number;
    updates: Partial<StrategySequenceStep>;
  };

  if (!groupId || stepNumber === undefined || !updates) {
    return NextResponse.json({ error: "groupId, stepNumber, and updates are required" }, { status: 400 });
  }

  const group = await loadGroup(supabase, orgCtx.orgId, campaignId, groupId);
  if (!group) return NextResponse.json({ error: "Strategy group not found" }, { status: 404 });

  const steps = [...(group.sequence_steps ?? [])];
  const idx = steps.findIndex((s) => s.step_number === stepNumber);
  if (idx === -1) return NextResponse.json({ error: `Step ${stepNumber} not found` }, { status: 404 });

  // Merge updates into the step
  steps[idx] = { ...steps[idx], ...updates, step_number: stepNumber };

  try {
    const saved = await saveSteps(supabase, groupId, steps);
    return NextResponse.json({ success: true, step: saved[idx], steps: saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── DELETE (remove step) ── */

export async function DELETE(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const { groupId, stepNumber } = body as { groupId: string; stepNumber: number };

  if (!groupId || stepNumber === undefined) {
    return NextResponse.json({ error: "groupId and stepNumber are required" }, { status: 400 });
  }

  const group = await loadGroup(supabase, orgCtx.orgId, campaignId, groupId);
  if (!group) return NextResponse.json({ error: "Strategy group not found" }, { status: 404 });

  const steps = (group.sequence_steps ?? []).filter((s) => s.step_number !== stepNumber);

  if (steps.length === (group.sequence_steps ?? []).length) {
    return NextResponse.json({ error: `Step ${stepNumber} not found` }, { status: 404 });
  }

  try {
    const saved = await saveSteps(supabase, groupId, steps);
    return NextResponse.json({ success: true, steps: saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
