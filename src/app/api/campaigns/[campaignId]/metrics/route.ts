/**
 * Campaign Metrics API — polls delivery provider for metrics.
 *
 * GET /api/campaigns/[campaignId]/metrics
 * Returns aggregate delivery metrics and per-variant status.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { getCampaignStatus } from "@/lib/email/campaign-engine";

export async function GET(
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

  try {
    const status = await getCampaignStatus(supabase, orgId, campaignId);

    // Calculate rates
    const totalSent = status.sent;
    const openRate = totalSent > 0 ? (status.deliveryMetrics.opened / totalSent * 100).toFixed(1) : "0.0";
    const clickRate = totalSent > 0 ? (status.deliveryMetrics.clicked / totalSent * 100).toFixed(1) : "0.0";
    const bounceRate = totalSent > 0 ? (status.deliveryMetrics.bounced / totalSent * 100).toFixed(1) : "0.0";

    return NextResponse.json({
      campaign: {
        id: status.id,
        name: status.name,
        status: status.status,
        campaignType: status.campaignType,
        deliveryChannel: status.deliveryChannel,
      },
      variants: {
        total: status.total,
        draft: status.draft,
        approved: status.approved,
        edited: status.edited,
        rejected: status.rejected,
        sent: status.sent,
        failed: status.failed,
      },
      delivery: {
        ...status.deliveryMetrics,
        openRate: parseFloat(openRate),
        clickRate: parseFloat(clickRate),
        bounceRate: parseFloat(bounceRate),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get metrics" },
      { status: 500 }
    );
  }
}
