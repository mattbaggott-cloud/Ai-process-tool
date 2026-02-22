/**
 * Campaign Variants API — CRUD for email variants in a campaign.
 *
 * GET  /api/campaigns/[campaignId]/variants?page=1&limit=20&status=draft
 * PATCH /api/campaigns/[campaignId]/variants
 *   Body: { variantId, action: "approve" | "reject" | "edit", editedContent? }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

export async function GET(
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
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const statusFilter = searchParams.get("status");

  const offset = (page - 1) * limit;

  let query = supabase
    .from("email_customer_variants")
    .select("*", { count: "exact" })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    variants: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}

export async function PATCH(
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
  const body = await request.json() as {
    variantId: string;
    action: "approve" | "reject" | "edit";
    editedContent?: {
      subject_line?: string;
      preview_text?: string;
      body_html?: string;
      body_text?: string;
    };
  };

  if (!body.variantId || !body.action) {
    return NextResponse.json({ error: "variantId and action are required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Build update object based on action
  const update: Record<string, unknown> = {
    updated_at: now,
    reviewed_at: now,
  };

  switch (body.action) {
    case "approve":
      update.status = "approved";
      break;
    case "reject":
      update.status = "rejected";
      break;
    case "edit":
      update.status = "edited";
      if (body.editedContent) {
        update.edited_content = body.editedContent;
      }
      break;
    default:
      return NextResponse.json({ error: `Invalid action: ${body.action}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("email_customer_variants")
    .update(update)
    .eq("id", body.variantId)
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update campaign approved count + auto-promote to "approved" when all variants reviewed
  const { count: approvedCount } = await supabase
    .from("email_customer_variants")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .in("status", ["approved", "edited"]);

  // Count remaining drafts — if none left, campaign is fully approved
  const { count: draftCount } = await supabase
    .from("email_customer_variants")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .eq("status", "draft");

  const campaignUpdate: Record<string, unknown> = {
    approved_count: approvedCount ?? 0,
    updated_at: now,
  };

  // Auto-promote campaign status: review → approved when no drafts remain
  if ((draftCount ?? 0) === 0 && (approvedCount ?? 0) > 0) {
    campaignUpdate.status = "approved";
  }

  await supabase
    .from("email_campaigns")
    .update(campaignUpdate)
    .eq("id", campaignId)
    .eq("org_id", orgId);

  // Auto-promote strategy group status: review → approved when all its variants are approved
  const variant = data as Record<string, unknown>;
  if (variant.strategy_group_id) {
    const groupId = variant.strategy_group_id as string;
    const { count: groupDrafts } = await supabase
      .from("email_customer_variants")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("org_id", orgId)
      .eq("strategy_group_id", groupId)
      .eq("status", "draft");

    const { count: groupApproved } = await supabase
      .from("email_customer_variants")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("org_id", orgId)
      .eq("strategy_group_id", groupId)
      .in("status", ["approved", "edited"]);

    if ((groupDrafts ?? 0) === 0 && (groupApproved ?? 0) > 0) {
      await supabase
        .from("campaign_strategy_groups")
        .update({ status: "approved", updated_at: now })
        .eq("id", groupId)
        .eq("org_id", orgId);
    }
  }

  return NextResponse.json({ variant: data });
}
