/**
 * Post-Sync Identity Resolution
 *
 * Shared helper called after any connector sync (HubSpot, Shopify, Klaviyo).
 * Runs the full 6-tier waterfall matcher, stores candidates for audit,
 * and auto-applies high-confidence matches (tier 1-2, confidence >= 0.90).
 *
 * Lower-confidence candidates (tier 3-6) stay as "pending" in
 * identity_match_candidates for manual review in the Explorer panel.
 *
 * This replaces direct calls to autoLinkByEmail() which created links
 * with no audit trail.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeResolution, applyResolution } from "./resolver";

/** Confidence threshold for auto-apply. Tier 1 (email=0.99) and Tier 2 (phone=0.90) pass. */
const AUTO_APPLY_CONFIDENCE = 0.90;

/**
 * Run auditable identity resolution after a connector sync.
 *
 * 1. Computes the full 6-tier waterfall across all data sources
 * 2. Auto-applies tier 1-2 matches (email, phone — confidence >= 0.90)
 * 3. Leaves tier 3-6 matches as pending for manual review
 * 4. Returns summary counts for logging
 */
export async function triggerPostSyncResolution(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<{
  totalCandidates: number;
  autoApplied: number;
  pendingReview: number;
  runId: string;
}> {
  // Step 1: Run the full waterfall matcher
  const resolution = await computeResolution(supabase, orgId, userId);

  if (resolution.totalCandidates === 0) {
    return {
      totalCandidates: 0,
      autoApplied: 0,
      pendingReview: 0,
      runId: resolution.runId,
    };
  }

  // Step 2: Identify high-confidence candidates to auto-apply
  const { data: allCandidates } = await supabase
    .from("identity_match_candidates")
    .select("id, confidence, status")
    .eq("run_id", resolution.runId)
    .eq("org_id", orgId)
    .eq("status", "pending");

  if (!allCandidates || allCandidates.length === 0) {
    return {
      totalCandidates: resolution.totalCandidates,
      autoApplied: 0,
      pendingReview: 0,
      runId: resolution.runId,
    };
  }

  const highConfidenceIds = allCandidates
    .filter((c) => (c.confidence as number) >= AUTO_APPLY_CONFIDENCE)
    .map((c) => c.id as string);

  const pendingCount = allCandidates.length - highConfidenceIds.length;

  // Step 3: Auto-apply high-confidence matches
  let autoApplied = 0;
  if (highConfidenceIds.length > 0) {
    const applyResult = await applyResolution(
      supabase,
      orgId,
      resolution.runId,
      userId,
      highConfidenceIds
    );
    autoApplied = applyResult.edgesCreated + applyResult.identityLinksCreated;
  }

  // Step 4: Update run status based on whether there are pending reviews
  if (pendingCount > 0) {
    // Partially applied — some candidates need review
    await supabase
      .from("identity_resolution_runs")
      .update({
        status: "partially_applied",
        applied_at: new Date().toISOString(),
      })
      .eq("id", resolution.runId);
  } else {
    // All candidates auto-applied
    await supabase
      .from("identity_resolution_runs")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
      })
      .eq("id", resolution.runId);
  }

  console.log(
    `[identity] Post-sync resolution: ${resolution.totalCandidates} candidates, ` +
    `${highConfidenceIds.length} auto-applied (≥${AUTO_APPLY_CONFIDENCE}), ` +
    `${pendingCount} pending review`
  );

  return {
    totalCandidates: resolution.totalCandidates,
    autoApplied: highConfidenceIds.length,
    pendingReview: pendingCount,
    runId: resolution.runId,
  };
}
