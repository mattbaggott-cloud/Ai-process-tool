/**
 * Campaign Send Schedule API
 *
 * GET  /api/campaigns/[campaignId]/schedule
 *   Returns the current send schedule for a campaign.
 *
 * PUT  /api/campaigns/[campaignId]/schedule
 *   Body: SendSchedule object
 *   Updates the send schedule rules (allowed days, hours, blocked dates).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import type { SendSchedule } from "@/lib/types/database";

type RouteParams = { params: Promise<{ campaignId: string }> };

/* ── GET ── */

export async function GET(_request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;

  const { data, error } = await supabase
    .from("email_campaigns")
    .select("send_schedule")
    .eq("id", campaignId)
    .eq("org_id", orgCtx.orgId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Return defaults if empty
  const schedule = (data.send_schedule as SendSchedule) ?? {};
  const withDefaults: SendSchedule = {
    timezone: schedule.timezone ?? "America/New_York",
    send_days: schedule.send_days ?? [1, 2, 3, 4, 5], // Mon-Fri
    send_hours: schedule.send_hours ?? { start: 9, end: 17 }, // 9am-5pm
    blocked_dates: schedule.blocked_dates ?? [],
  };

  return NextResponse.json({ schedule: withDefaults });
}

/* ── PUT ── */

export async function PUT(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { campaignId } = await params;
  const body = await request.json();
  const schedule = body as SendSchedule;

  // Validate
  if (schedule.send_days) {
    if (!Array.isArray(schedule.send_days) || schedule.send_days.some((d) => d < 0 || d > 6)) {
      return NextResponse.json({ error: "send_days must be array of 0-6 (Sun-Sat)" }, { status: 400 });
    }
  }
  if (schedule.send_hours) {
    const { start, end } = schedule.send_hours;
    if (typeof start !== "number" || typeof end !== "number" || start < 0 || end > 24 || start >= end) {
      return NextResponse.json({ error: "send_hours must have start < end in 0-24 range" }, { status: 400 });
    }
  }
  if (schedule.blocked_dates) {
    if (!Array.isArray(schedule.blocked_dates)) {
      return NextResponse.json({ error: "blocked_dates must be an array of ISO date strings" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("email_campaigns")
    .update({
      send_schedule: schedule,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("org_id", orgCtx.orgId)
    .select("send_schedule")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Campaign not found" }, { status: error ? 500 : 404 });
  }

  return NextResponse.json({ success: true, schedule: data.send_schedule });
}
