/**
 * Policy Engine — evaluates per-org trust controls for action execution.
 *
 * Policies use glob patterns on action names (e.g. "crm.*", "crm.deal.*", "*")
 * and are evaluated in priority order (lower priority number = higher precedence).
 * First matching policy wins.
 *
 * Effects:
 *   - "allow"             → action proceeds immediately
 *   - "require_approval"  → action blocked until approved by specified role
 *   - "deny"              → action rejected outright
 *
 * If no policy matches, the default is "allow" (permissive by default).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ── */

export interface PolicyDecision {
  effect: "allow" | "require_approval" | "deny";
  policyId: string | null;       // which policy matched (null = default allow)
  policyDescription: string | null;
  approvalRole: string | null;   // only set when effect = require_approval
}

export interface PolicyConditions {
  actor_type?: string;           // only match specific actor types (e.g. "ai")
  min_value?: number;            // match when input has a "value" field >= this
  max_value?: number;            // match when input has a "value" field <= this
  fields?: Record<string, unknown>; // match specific input field values
}

interface PolicyRow {
  id: string;
  org_id: string;
  action_pattern: string;
  conditions: PolicyConditions;
  effect: "allow" | "require_approval" | "deny";
  approval_role: string | null;
  priority: number;
  description: string | null;
  is_active: boolean;
}

/* ── Policy Cache ── */

const policyCache = new Map<string, { policies: PolicyRow[]; loadedAt: number }>();
const POLICY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/* ── Public API ── */

/**
 * Evaluate policies for a given action.
 * Returns the effect of the first matching policy, or "allow" if none match.
 */
export async function checkPolicy(
  supabase: SupabaseClient,
  orgId: string,
  actionName: string,
  input: Record<string, unknown>,
  actorType: string
): Promise<PolicyDecision> {
  const policies = await loadPolicies(supabase, orgId);

  // Evaluate in priority order (already sorted by loadPolicies)
  for (const policy of policies) {
    if (!matchesPattern(actionName, policy.action_pattern)) continue;
    if (!matchesConditions(policy.conditions, input, actorType)) continue;

    // First match wins
    return {
      effect: policy.effect,
      policyId: policy.id,
      policyDescription: policy.description,
      approvalRole: policy.effect === "require_approval" ? (policy.approval_role ?? "admin") : null,
    };
  }

  // Default: permissive
  return {
    effect: "allow",
    policyId: null,
    policyDescription: null,
    approvalRole: null,
  };
}

/**
 * Invalidate cached policies for an org (call after policy changes).
 */
export function invalidatePolicyCache(orgId: string): void {
  policyCache.delete(orgId);
}

/* ── Pattern Matching ── */

/**
 * Match an action name against a glob pattern.
 * Supports: "*" (match everything), "crm.*" (category), "crm.deal.*" (subcategory),
 * exact matches like "crm.deal.stage.update".
 */
function matchesPattern(actionName: string, pattern: string): boolean {
  // Exact match
  if (pattern === actionName) return true;

  // Universal wildcard
  if (pattern === "*") return true;

  // Glob patterns: convert "crm.*" to regex "^crm\..*$"
  if (pattern.includes("*")) {
    const regexStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
    try {
      return new RegExp(regexStr).test(actionName);
    } catch {
      return false;
    }
  }

  return false;
}

/* ── Condition Matching ── */

/**
 * Check if the action context matches the policy conditions.
 * Empty conditions = always match.
 */
function matchesConditions(
  conditions: PolicyConditions,
  input: Record<string, unknown>,
  actorType: string
): boolean {
  // No conditions = match everything
  if (!conditions || Object.keys(conditions).length === 0) return true;

  // Check actor_type condition
  if (conditions.actor_type && conditions.actor_type !== actorType) {
    return false;
  }

  // Check min_value condition (looks for "value" or "amount" field in input)
  const valueField = (input.value ?? input.amount ?? input.deal_value) as number | undefined;
  if (conditions.min_value != null && valueField != null) {
    if (valueField < conditions.min_value) return false;
  }

  // Check max_value condition
  if (conditions.max_value != null && valueField != null) {
    if (valueField > conditions.max_value) return false;
  }

  // Check specific field values
  if (conditions.fields) {
    for (const [key, expected] of Object.entries(conditions.fields)) {
      if (input[key] !== expected) return false;
    }
  }

  return true;
}

/* ── Internal ── */

async function loadPolicies(
  supabase: SupabaseClient,
  orgId: string
): Promise<PolicyRow[]> {
  // Return cache if fresh
  const cached = policyCache.get(orgId);
  if (cached && Date.now() - cached.loadedAt < POLICY_CACHE_TTL_MS) {
    return cached.policies;
  }

  try {
    const { data, error } = await supabase
      .from("action_policies")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("priority", { ascending: true }); // Lower number = higher priority

    if (error) {
      console.error("[PolicyEngine] Load failed:", error.message);
      return cached?.policies ?? [];
    }

    const policies = (data ?? []) as PolicyRow[];
    policyCache.set(orgId, { policies, loadedAt: Date.now() });
    return policies;
  } catch (err) {
    console.error("[PolicyEngine] Load error:", err);
    return cached?.policies ?? [];
  }
}
