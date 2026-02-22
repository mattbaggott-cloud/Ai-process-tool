/**
 * Campaign CRUD API
 *
 * POST /api/campaigns/[campaignId]  (action: "cancel")
 *   Cancels an in-progress generation. The engine checks status before each
 *   batch and stops when it sees "cancelled".
 *
 * DELETE /api/campaigns/[campaignId]
 *   Deletes a campaign and all associated data (strategy groups, variants, etc.)
 *   via CASCADE. Only the org owner can delete.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orgId } = orgCtx;
  const { campaignId } = await params;
  const body = await request.json() as { action?: string };

  if (body.action === "cancel") {
    // Verify campaign exists and is generating
    const { data: campaign, error: fetchErr } = await supabase
      .from("email_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (fetchErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.status !== "generating") {
      return NextResponse.json({ error: "Campaign is not currently generating" }, { status: 400 });
    }

    // Set status to cancelled — the engine checks this before each batch
    const { error: updateErr } = await supabase
      .from("email_campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("org_id", orgId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: "cancelled" });
  }

  if (body.action === "pause") {
    const { data: campaign, error: fetchErr } = await supabase
      .from("email_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (fetchErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.status !== "generating") {
      return NextResponse.json({ error: "Campaign is not currently generating" }, { status: 400 });
    }

    const { error: updateErr } = await supabase
      .from("email_campaigns")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("org_id", orgId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: "paused" });
  }

  if (body.action === "resume") {
    const { data: campaign, error: fetchErr } = await supabase
      .from("email_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (fetchErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (!["paused", "cancelled", "failed"].includes(campaign.status as string)) {
      return NextResponse.json({ error: "Campaign is not paused, cancelled, or failed" }, { status: 400 });
    }

    // Set status back to generating — the generate endpoint will be called by the UI
    const { error: updateErr } = await supabase
      .from("email_campaigns")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("org_id", orgId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: "generating" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orgId } = orgCtx;
  const { campaignId } = await params;

  // Verify campaign exists and belongs to this org
  const { data: campaign, error: fetchErr } = await supabase
    .from("email_campaigns")
    .select("id, name, status")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (fetchErr || !campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  // Don't allow deleting campaigns that are currently sending
  if (campaign.status === "sending") {
    return NextResponse.json(
      { error: "Cannot delete a campaign that is currently sending" },
      { status: 400 }
    );
  }

  // Delete the campaign — strategy groups + variants cascade automatically
  const { error: deleteErr } = await supabase
    .from("email_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("org_id", orgId);

  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, deleted: campaign.name });
}
