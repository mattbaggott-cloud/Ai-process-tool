/**
 * Campaign Send API
 *
 * POST /api/campaigns/[campaignId]/send
 *   Body: { confirmed: boolean }
 *
 * If confirmed=false → returns send summary (counts, channel, warnings)
 * If confirmed=true  → triggers send through provider
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { sendCampaign } from "@/lib/email/campaign-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orgId, user } = orgCtx;
  const userId = user.id;
  const { campaignId } = await params;
  const body = (await request.json()) as { confirmed?: boolean };

  // Load campaign
  const { data: campaign, error: campErr } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (campErr || !campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  // Get variant counts
  const { count: approvedCount } = await supabase
    .from("email_customer_variants")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .in("status", ["approved", "edited"]);

  const { count: draftCount } = await supabase
    .from("email_customer_variants")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .eq("status", "draft");

  // If not confirmed, return summary
  if (!body.confirmed) {
    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        delivery_channel: campaign.delivery_channel,
      },
      readyToSend: approvedCount ?? 0,
      draftRemaining: draftCount ?? 0,
      warnings:
        (draftCount ?? 0) > 0
          ? [`${draftCount} variants still in draft — they won't be sent.`]
          : [],
    });
  }

  // Confirmed — send the campaign
  if ((approvedCount ?? 0) === 0) {
    return NextResponse.json(
      { error: "No approved variants to send. Approve some emails first." },
      { status: 400 }
    );
  }

  try {
    const result = await sendCampaign(supabase, orgId, userId, campaignId);
    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      status: result.status,
    });
  } catch (error) {
    console.error("Campaign send error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Send failed",
      },
      { status: 500 }
    );
  }
}
