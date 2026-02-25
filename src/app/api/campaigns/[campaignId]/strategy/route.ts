/**
 * Campaign Strategy API
 *
 * GET  /api/campaigns/[campaignId]/strategy
 *   Returns strategy groups for a campaign with customer counts.
 *   Query params:
 *     ?action=members&groupId=X&page=1&limit=50
 *     Returns paginated enriched member list for a strategy group.
 *
 * PATCH /api/campaigns/[campaignId]/strategy
 *   Update a strategy group (edit prompts, reorder, approve/reject).
 *   Body: { groupId, action: "approve" | "reject" | "update", updates? }
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

  // Check for members action
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "members") {
    return handleGetMembers(supabase, orgId, campaignId, url);
  }

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

  // Load strategy groups
  const { data: groups, error: groupErr } = await supabase
    .from("campaign_strategy_groups")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });

  if (groupErr) {
    return NextResponse.json({ error: groupErr.message }, { status: 500 });
  }

  // Get variant counts per group
  const groupsWithCounts = await Promise.all(
    (groups ?? []).map(async (group) => {
      const { count: totalVariants } = await supabase
        .from("email_customer_variants")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .eq("strategy_group_id", group.id);

      const { count: approvedVariants } = await supabase
        .from("email_customer_variants")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .eq("strategy_group_id", group.id)
        .in("status", ["approved", "edited"]);

      const { count: sentVariants } = await supabase
        .from("email_customer_variants")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .eq("strategy_group_id", group.id)
        .eq("status", "sent");

      // Self-healing: if group is "review" but all variants are approved, auto-promote
      const total = totalVariants ?? 0;
      const approved = approvedVariants ?? 0;
      if (group.status === "review" && total > 0 && approved === total) {
        await supabase
          .from("campaign_strategy_groups")
          .update({ status: "approved", updated_at: new Date().toISOString() })
          .eq("id", group.id);
        group.status = "approved";
      }

      return {
        ...group,
        variant_counts: {
          total,
          approved,
          sent: sentVariants ?? 0,
        },
      };
    })
  );

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      has_strategy: campaign.has_strategy,
      delivery_channel: campaign.delivery_channel,
      total_variants: campaign.total_variants,
      approved_count: campaign.approved_count,
      sent_count: campaign.sent_count,
      email_type: campaign.email_type,
      campaign_type: campaign.campaign_type,
      segment_id: campaign.segment_id,
      prompt_used: campaign.prompt_used,
      stats: campaign.stats,
    },
    groups: groupsWithCounts,
  });
}

/* ── Members sub-handler ── */

import type { SupabaseClient } from "@supabase/supabase-js";

async function handleGetMembers(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string,
  url: URL
) {
  const groupId = url.searchParams.get("groupId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  // Handle synthetic group for non-strategy campaigns
  if (groupId === "synthetic") {
    return handleSyntheticMembers(supabase, orgId, campaignId, page, limit);
  }

  // Load the strategy group to get customer_ids
  const { data: group, error: groupErr } = await supabase
    .from("campaign_strategy_groups")
    .select("customer_ids, customer_count")
    .eq("id", groupId)
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (groupErr || !group) {
    return NextResponse.json({ error: "Strategy group not found" }, { status: 404 });
  }

  const allIds: string[] = group.customer_ids ?? [];
  const total = allIds.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return NextResponse.json({ members: [], total, page, totalPages });
  }

  // Fetch customer details
  const { data: customers } = await supabase
    .from("ecom_customers")
    .select("id, email, first_name, last_name, orders_count, total_spent")
    .in("id", pageIds)
    .eq("org_id", orgId);

  // Fetch behavioral profiles
  const { data: profiles } = await supabase
    .from("customer_behavioral_profiles")
    .select("ecom_customer_id, lifecycle_stage, recency_score, frequency_score, monetary_score, top_product_title")
    .in("ecom_customer_id", pageIds)
    .eq("org_id", orgId);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.ecom_customer_id, p])
  );

  // Build enriched member list (preserve order from customer_ids)
  const customerMap = new Map(
    (customers ?? []).map((c) => [c.id, c])
  );

  const members = pageIds
    .map((id) => {
      const c = customerMap.get(id);
      if (!c) return null;
      const p = profileMap.get(id);
      return {
        id: c.id,
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email?.split("@")[0] || "—",
        orders_count: c.orders_count ?? 0,
        total_spent: c.total_spent ?? 0,
        lifecycle_stage: p?.lifecycle_stage ?? null,
        rfm_score: p
          ? `${p.recency_score ?? "—"}-${p.frequency_score ?? "—"}-${p.monetary_score ?? "—"}`
          : null,
        top_product: p?.top_product_title ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members, total, page, totalPages });
}

/**
 * Handle member listing for non-strategy campaigns (synthetic group).
 * Falls back to: segment members → campaign variant customers → all customers.
 */
async function handleSyntheticMembers(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string,
  page: number,
  limit: number
) {
  // Load campaign to check for segment
  const { data: campaign } = await supabase
    .from("email_campaigns")
    .select("segment_id")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let allIds: string[] = [];

  if (campaign.segment_id) {
    // Load member IDs from segment
    const { data: members } = await supabase
      .from("segment_members")
      .select("ecom_customer_id")
      .eq("segment_id", campaign.segment_id)
      .eq("org_id", orgId);
    allIds = (members ?? []).map((m) => m.ecom_customer_id as string);
  } else {
    // No segment — use variant customer IDs if available
    const { data: variants } = await supabase
      .from("email_customer_variants")
      .select("ecom_customer_id")
      .eq("campaign_id", campaignId)
      .eq("org_id", orgId);

    if (variants && variants.length > 0) {
      allIds = [...new Set(variants.map((v) => v.ecom_customer_id as string))];
    } else {
      // Last resort: all customers
      const { data: customers } = await supabase
        .from("ecom_customers")
        .select("id")
        .eq("org_id", orgId)
        .limit(1000);
      allIds = (customers ?? []).map((c) => c.id as string);
    }
  }

  const total = allIds.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return NextResponse.json({ members: [], total, page, totalPages });
  }

  // Fetch customer details (same pattern as handleGetMembers)
  const { data: customers } = await supabase
    .from("ecom_customers")
    .select("id, email, first_name, last_name, orders_count, total_spent")
    .in("id", pageIds)
    .eq("org_id", orgId);

  const { data: profiles } = await supabase
    .from("customer_behavioral_profiles")
    .select("ecom_customer_id, lifecycle_stage, recency_score, frequency_score, monetary_score, top_product_title")
    .in("ecom_customer_id", pageIds)
    .eq("org_id", orgId);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.ecom_customer_id, p])
  );

  const customerMap = new Map(
    (customers ?? []).map((c) => [c.id, c])
  );

  const members = pageIds
    .map((id) => {
      const c = customerMap.get(id);
      if (!c) return null;
      const p = profileMap.get(id);
      return {
        id: c.id,
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email?.split("@")[0] || "—",
        orders_count: c.orders_count ?? 0,
        total_spent: c.total_spent ?? 0,
        lifecycle_stage: p?.lifecycle_stage ?? null,
        rfm_score: p
          ? `${p.recency_score ?? "—"}-${p.frequency_score ?? "—"}-${p.monetary_score ?? "—"}`
          : null,
        top_product: p?.top_product_title ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members, total, page, totalPages });
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
  const body = (await request.json()) as {
    groupId: string;
    action: "approve" | "reject" | "update";
    updates?: {
      group_name?: string;
      group_description?: string;
      sequence_steps?: unknown[];
    };
  };

  if (!body.groupId || !body.action) {
    return NextResponse.json(
      { error: "groupId and action are required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  switch (body.action) {
    case "approve": {
      const { data, error } = await supabase
        .from("campaign_strategy_groups")
        .update({ status: "approved", updated_at: now })
        .eq("id", body.groupId)
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ group: data });
    }

    case "reject": {
      const { data, error } = await supabase
        .from("campaign_strategy_groups")
        .update({ status: "draft", updated_at: now })
        .eq("id", body.groupId)
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ group: data });
    }

    case "update": {
      const updates: Record<string, unknown> = { updated_at: now };
      if (body.updates?.group_name) updates.group_name = body.updates.group_name;
      if (body.updates?.group_description) updates.group_description = body.updates.group_description;
      if (body.updates?.sequence_steps) {
        updates.sequence_steps = body.updates.sequence_steps;
        // total_emails = customer_count × steps (fetch current customer_count)
        const { data: grp } = await supabase
          .from("campaign_strategy_groups")
          .select("customer_count")
          .eq("id", body.groupId)
          .eq("campaign_id", campaignId)
          .eq("org_id", orgId)
          .single();
        const customerCount = grp?.customer_count ?? 0;
        updates.total_emails = customerCount * (body.updates.sequence_steps as unknown[]).length;
      }

      const { data, error } = await supabase
        .from("campaign_strategy_groups")
        .update(updates)
        .eq("id", body.groupId)
        .eq("campaign_id", campaignId)
        .eq("org_id", orgId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ group: data });
    }

    default:
      return NextResponse.json(
        { error: `Invalid action: ${body.action}` },
        { status: 400 }
      );
  }
}
