/**
 * Action Executor — wraps existing tool-executor with the Action Framework.
 *
 * Flow:
 *   1. Resolve tool name → action name (via registry)
 *   2. Check policy engine → allow / require_approval / deny
 *   3. Create execution record (status: executing)
 *   4. Call existing tool handler (unchanged)
 *   5. Update execution record (status: completed/failed)
 *   6. Emit event + sync graph (fire-and-forget, via existing executeToolWithGraph)
 *
 * The existing tool handlers are completely untouched.
 * This wraps `executeToolWithGraph` from tool-executor.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/types/database";
import { executeToolWithGraph } from "@/app/api/chat/tool-executor";
import { resolveActionName, getActionDefinition } from "./action-registry";
import { checkPolicy } from "./policy-engine";
import { emitEventInBackground } from "./event-emitter";

/* ── Types ── */

export interface ActionResult {
  success: boolean;
  message: string;
  executionId: string | null;      // id in action_executions table
  actionName: string;              // namespaced action name
  policyEffect: string | null;     // what policy was applied
  denied: boolean;                 // true if policy denied the action
  requiresApproval: boolean;       // true if waiting for approval
}

/* ── Main Entry Point ── */

/**
 * Execute an action with full policy checks and audit trail.
 * This is the replacement for `executeToolWithGraph` in route.ts.
 */
export async function executeAction(
  toolName: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole = "viewer",
  sessionId?: string,
  actorType: string = "ai",
  userTimezone: string = "America/New_York",
): Promise<ActionResult> {
  const actionName = resolveActionName(toolName);
  const startTime = Date.now();

  // ── 1. Check policy ──
  let policyDecision;
  try {
    policyDecision = await checkPolicy(supabase, orgId, actionName, input, actorType);
  } catch (err) {
    console.error("[Action] Policy check failed:", err);
    // Fail-open: allow if policy engine errors (don't block users)
    policyDecision = { effect: "allow" as const, policyId: null, policyDescription: null, approvalRole: null };
  }

  // ── 2. Handle deny ──
  if (policyDecision.effect === "deny") {
    // Create denied execution record
    const executionId = await createExecution(supabase, {
      orgId, actionName, actorType, actorId: userId, sessionId,
      input, status: "denied",
      policyApplied: policyDecision.policyId,
      policyEffect: "deny",
    });

    // Emit denied event
    emitEventInBackground(supabase, {
      org_id: orgId,
      event_type: "action.denied",
      event_category: "ai",
      actor_type: actorType as "user" | "ai" | "system" | "connector",
      actor_id: userId,
      tool_name: toolName,
      session_id: sessionId ?? null,
      payload: {
        action_name: actionName,
        policy_id: policyDecision.policyId,
        policy_description: policyDecision.policyDescription,
        reason: "denied_by_policy",
      },
    });

    return {
      success: false,
      message: policyDecision.policyDescription
        ? `Action denied by policy: ${policyDecision.policyDescription}`
        : `Action "${actionName}" is denied by organizational policy.`,
      executionId,
      actionName,
      policyEffect: "deny",
      denied: true,
      requiresApproval: false,
    };
  }

  // ── 3. Handle require_approval ──
  if (policyDecision.effect === "require_approval") {
    const executionId = await createExecution(supabase, {
      orgId, actionName, actorType, actorId: userId, sessionId,
      input, status: "pending",
      policyApplied: policyDecision.policyId,
      policyEffect: "require_approval",
      requiresApproval: true,
    });

    emitEventInBackground(supabase, {
      org_id: orgId,
      event_type: "action.approval_required",
      event_category: "ai",
      actor_type: actorType as "user" | "ai" | "system" | "connector",
      actor_id: userId,
      tool_name: toolName,
      session_id: sessionId ?? null,
      payload: {
        action_name: actionName,
        execution_id: executionId,
        policy_id: policyDecision.policyId,
        approval_role: policyDecision.approvalRole,
      },
    });

    return {
      success: false,
      message: `This action requires approval from a ${policyDecision.approvalRole ?? "admin"}. `
        + (policyDecision.policyDescription ? `Policy: ${policyDecision.policyDescription}. ` : "")
        + `The request has been logged and is pending approval.`,
      executionId,
      actionName,
      policyEffect: "require_approval",
      denied: false,
      requiresApproval: true,
    };
  }

  // ── 4. Execute (policy = allow) ──
  // Create execution record
  const executionId = await createExecution(supabase, {
    orgId, actionName, actorType, actorId: userId, sessionId,
    input, status: "executing",
    policyApplied: policyDecision.policyId,
    policyEffect: "allow",
  });

  // Call the existing tool executor (handles events + graph sync)
  const result = await executeToolWithGraph(
    toolName, input, supabase, userId, orgId, userRole, sessionId, userTimezone
  );

  // ── 5. Update execution record ──
  const durationMs = Date.now() - startTime;
  await updateExecution(supabase, executionId, {
    status: result.success ? "completed" : "failed",
    output: { message: result.message },
    error: result.success ? null : result.message,
    durationMs,
  });

  // Emit action completed/failed event
  emitEventInBackground(supabase, {
    org_id: orgId,
    event_type: result.success ? "action.completed" : "action.failed",
    event_category: "ai",
    actor_type: actorType as "user" | "ai" | "system" | "connector",
    actor_id: userId,
    tool_name: toolName,
    session_id: sessionId ?? null,
    payload: {
      action_name: actionName,
      execution_id: executionId,
      success: result.success,
      duration_ms: durationMs,
    },
  });

  return {
    success: result.success,
    message: result.message,
    executionId,
    actionName,
    policyEffect: "allow",
    denied: false,
    requiresApproval: false,
  };
}

/* ── Execution Record Helpers ── */

async function createExecution(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    actionName: string;
    actorType: string;
    actorId: string;
    sessionId?: string;
    input: Record<string, unknown>;
    status: string;
    policyApplied: string | null;
    policyEffect: string | null;
    requiresApproval?: boolean;
  }
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("action_executions")
      .insert({
        org_id: params.orgId,
        action_name: params.actionName,
        actor_type: params.actorType,
        actor_id: params.actorId,
        session_id: params.sessionId ?? null,
        input: params.input,
        status: params.status,
        policy_applied: params.policyApplied,
        policy_effect: params.policyEffect,
        requires_approval: params.requiresApproval ?? false,
        started_at: new Date().toISOString(),
        completed_at: ["denied", "failed"].includes(params.status)
          ? new Date().toISOString()
          : null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Action] Create execution failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[Action] Create execution error:", err);
    return null;
  }
}

async function updateExecution(
  supabase: SupabaseClient,
  executionId: string | null,
  params: {
    status: string;
    output?: Record<string, unknown>;
    error?: string | null;
    durationMs?: number;
  }
): Promise<void> {
  if (!executionId) return;

  try {
    const { error } = await supabase
      .from("action_executions")
      .update({
        status: params.status,
        output: params.output ?? null,
        error: params.error ?? null,
        duration_ms: params.durationMs ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", executionId);

    if (error) {
      console.error("[Action] Update execution failed:", error.message);
    }
  } catch (err) {
    console.error("[Action] Update execution error:", err);
  }
}
