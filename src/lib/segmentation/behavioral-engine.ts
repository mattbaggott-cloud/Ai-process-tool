import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Segment,
  SegmentRule,
  SegmentMember,
  CustomerBehavioralProfile,
  DiscoveredSegment,
} from "@/lib/types/database";

/* ── Types ─────────────────────────────────────────────── */

export interface ComputeResult {
  profiles_updated: number;
  computed_at: string;
}

export interface CreateSegmentInput {
  name: string;
  description?: string;
  segment_type?: Segment["segment_type"];
  rules: SegmentRule;
  parent_segment_id?: string;
  branch_dimension?: string;
  branch_value?: string;
}

/* ── Compute Behavioral Profiles ───────────────────────── */

export async function computeBehavioralProfiles(
  supabase: SupabaseClient,
  orgId: string
): Promise<ComputeResult> {
  const { data, error } = await supabase.rpc(
    "analytics_compute_behavioral_profiles",
    { p_org_id: orgId }
  );

  if (error) throw new Error(`Failed to compute profiles: ${error.message}`);

  const result = data as { profiles_updated: number; computed_at: string };
  return {
    profiles_updated: result.profiles_updated ?? 0,
    computed_at: result.computed_at ?? new Date().toISOString(),
  };
}

/* ── Discover Segments ─────────────────────────────────── */

export async function discoverSegments(
  supabase: SupabaseClient,
  orgId: string,
  options?: { minSize?: number }
): Promise<DiscoveredSegment[]> {
  // First, ensure profiles are computed
  await computeBehavioralProfiles(supabase, orgId);

  const { data, error } = await supabase.rpc(
    "analytics_discover_segments",
    {
      p_org_id: orgId,
      p_min_size: options?.minSize ?? 5,
    }
  );

  if (error) throw new Error(`Failed to discover segments: ${error.message}`);

  return (data as DiscoveredSegment[]) ?? [];
}

/* ── Create Segment (with tree support) ────────────────── */

export async function createSegment(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: CreateSegmentInput
): Promise<Segment & { members_assigned: number }> {
  // If parent is specified, resolve its depth and path
  let depth = 0;
  let path: string[] = [];

  if (input.parent_segment_id) {
    const { data: parent } = await supabase
      .from("segments")
      .select("id, depth, path")
      .eq("id", input.parent_segment_id)
      .single();

    if (parent) {
      depth = (parent.depth as number) + 1;
      path = [...((parent.path as string[]) ?? []), parent.id as string];
    }
  }

  // Create segment record
  const { data: segment, error: insertErr } = await supabase
    .from("segments")
    .insert({
      org_id: orgId,
      name: input.name,
      description: input.description ?? null,
      segment_type: input.segment_type ?? "behavioral",
      rules: input.rules,
      parent_id: input.parent_segment_id ?? null,
      depth,
      path,
      branch_dimension: input.branch_dimension ?? null,
      branch_value: input.branch_value ?? null,
      created_by: userId,
    })
    .select()
    .single();

  if (insertErr || !segment) {
    throw new Error(`Failed to create segment: ${insertErr?.message}`);
  }

  // Assign members using the rules
  const { data: assignResult, error: assignErr } = await supabase.rpc(
    "analytics_assign_segment_members",
    {
      p_org_id: orgId,
      p_segment_id: segment.id,
      p_rules: input.rules,
    }
  );

  if (assignErr) {
    console.error(`[segmentation] Assignment failed: ${assignErr.message}`);
  }

  const membersAssigned = (assignResult as { assigned: number })?.assigned ?? 0;

  return {
    ...(segment as unknown as Segment),
    members_assigned: membersAssigned,
  };
}

/* ── Get Segment Tree ──────────────────────────────────── */

export async function getSegmentTree(
  supabase: SupabaseClient,
  orgId: string,
  rootId?: string
): Promise<Segment[]> {
  const { data, error } = await supabase.rpc(
    "analytics_segment_tree",
    {
      p_org_id: orgId,
      p_root_id: rootId ?? null,
    }
  );

  if (error) throw new Error(`Failed to get segment tree: ${error.message}`);

  return (data as Segment[]) ?? [];
}

/* ── Get Segment Members ───────────────────────────────── */

export async function getSegmentMembers(
  supabase: SupabaseClient,
  orgId: string,
  segmentId: string,
  options?: { limit?: number }
): Promise<SegmentMember[]> {
  const limit = options?.limit ?? 20;

  const { data, error } = await supabase
    .from("segment_members")
    .select("*")
    .eq("org_id", orgId)
    .eq("segment_id", segmentId)
    .order("score", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get segment members: ${error.message}`);

  return (data as SegmentMember[]) ?? [];
}

/* ── Get Customer Behavioral Profile ───────────────────── */

export async function getCustomerProfile(
  supabase: SupabaseClient,
  orgId: string,
  customerId: string
): Promise<CustomerBehavioralProfile | null> {
  const { data, error } = await supabase
    .from("customer_behavioral_profiles")
    .select("*")
    .eq("org_id", orgId)
    .eq("ecom_customer_id", customerId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get profile: ${error.message}`);
  }

  return (data as CustomerBehavioralProfile) ?? null;
}

/* ── Find Customer by Email or Name ────────────────────── */

export async function findCustomerByEmailOrName(
  supabase: SupabaseClient,
  orgId: string,
  query: string
): Promise<{ id: string; email: string; first_name: string; last_name: string } | null> {
  // Try email first
  const { data: byEmail } = await supabase
    .from("ecom_customers")
    .select("id, email, first_name, last_name")
    .eq("org_id", orgId)
    .ilike("email", query)
    .limit(1)
    .single();

  if (byEmail) return byEmail as { id: string; email: string; first_name: string; last_name: string };

  // Try name search
  const { data: byName } = await supabase
    .from("ecom_customers")
    .select("id, email, first_name, last_name")
    .eq("org_id", orgId)
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(1)
    .single();

  return byName as { id: string; email: string; first_name: string; last_name: string } | null;
}

/* ── Get Segment Summary (for system prompt) ───────────── */

export async function getSegmentSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ total: number; byType: Record<string, number>; totalMembers: number }> {
  const empty = { total: 0, byType: {} as Record<string, number>, totalMembers: 0 };

  try {
    const { data: segments, error } = await supabase
      .from("segments")
      .select("segment_type, customer_count")
      .eq("org_id", orgId)
      .eq("status", "active");

    // Table doesn't exist yet (migration not run) or other error
    if (error || !segments || segments.length === 0) {
      return empty;
    }

    const byType: Record<string, number> = {};
    let totalMembers = 0;
    for (const s of segments) {
      const t = (s.segment_type as string) || "custom";
      byType[t] = (byType[t] ?? 0) + 1;
      totalMembers += (s.customer_count as number) ?? 0;
    }

    return { total: segments.length, byType, totalMembers };
  } catch {
    return empty;
  }
}
