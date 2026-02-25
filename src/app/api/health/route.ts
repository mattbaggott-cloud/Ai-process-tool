/**
 * Health Check Endpoint — GET /api/health
 *
 * Verifies that all infrastructure dependencies are available:
 * 1. Supabase connectivity (simple query + latency)
 * 2. get_platform_schema RPC exists (migration 030)
 * 3. exec_safe_sql RPC exists (migration 030)
 * 4. ANTHROPIC_API_KEY present
 * 5. OPENAI_API_KEY present (for embeddings)
 *
 * Returns:
 * - 200 { status: "healthy" } — all checks pass
 * - 200 { status: "degraded" } — some non-critical checks fail
 * - 503 { status: "unhealthy" } — critical checks fail
 *
 * No auth required — this is a public endpoint for monitoring.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

interface HealthCheck {
  name: string;
  status: "pass" | "fail";
  latency_ms?: number;
  message?: string;
}

export async function GET() {
  const checks: HealthCheck[] = [];
  const startTime = Date.now();

  // Create a lightweight Supabase client (no auth, just connectivity)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── Check 1: Supabase connectivity ──
  if (!supabaseUrl || !supabaseKey) {
    checks.push({
      name: "supabase_connectivity",
      status: "fail",
      message: "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set",
    });
  } else {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
      const queryStart = Date.now();
      const { error } = await supabase.from("orgs").select("id").limit(1);
      const latency = Date.now() - queryStart;

      if (error) {
        checks.push({
          name: "supabase_connectivity",
          status: "fail",
          latency_ms: latency,
          message: error.message,
        });
      } else {
        checks.push({
          name: "supabase_connectivity",
          status: "pass",
          latency_ms: latency,
        });
      }
    } catch (err) {
      checks.push({
        name: "supabase_connectivity",
        status: "fail",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // ── Check 2: get_platform_schema RPC (migration 030) ──
    try {
      const rpcStart = Date.now();
      const { error } = await supabase.rpc("get_platform_schema").limit(1);
      const latency = Date.now() - rpcStart;

      checks.push({
        name: "rpc_get_platform_schema",
        status: error ? "fail" : "pass",
        latency_ms: latency,
        message: error?.message,
      });
    } catch (err) {
      checks.push({
        name: "rpc_get_platform_schema",
        status: "fail",
        message: err instanceof Error ? err.message : "RPC not found — deploy migration 030",
      });
    }

    // ── Check 3: exec_safe_sql RPC (migration 030) ──
    try {
      const rpcStart = Date.now();
      const { error } = await supabase.rpc("exec_safe_sql", {
        query_text: "SELECT 1 AS health_check",
        org_id_param: "00000000-0000-0000-0000-000000000000",
      });
      const latency = Date.now() - rpcStart;

      // exec_safe_sql may return an error for the fake org_id, but if
      // the RPC exists the error will be about data, not "function not found"
      const isRpcMissing = error?.message?.includes("function") && error?.message?.includes("does not exist");
      checks.push({
        name: "rpc_exec_safe_sql",
        status: isRpcMissing ? "fail" : "pass",
        latency_ms: latency,
        message: isRpcMissing ? "RPC not found — deploy migration 030" : undefined,
      });
    } catch (err) {
      checks.push({
        name: "rpc_exec_safe_sql",
        status: "fail",
        message: err instanceof Error ? err.message : "RPC not found — deploy migration 030",
      });
    }
  }

  // ── Check 4: ANTHROPIC_API_KEY present ──
  checks.push({
    name: "anthropic_api_key",
    status: process.env.ANTHROPIC_API_KEY ? "pass" : "fail",
    message: process.env.ANTHROPIC_API_KEY ? undefined : "ANTHROPIC_API_KEY not set",
  });

  // ── Check 5: OPENAI_API_KEY present (for embeddings) ──
  checks.push({
    name: "openai_api_key",
    status: process.env.OPENAI_API_KEY ? "pass" : "fail",
    message: process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY not set — embeddings will fail",
  });

  // ── Determine overall status ──
  const criticalChecks = ["supabase_connectivity", "anthropic_api_key"];
  const hasCriticalFailure = checks.some(
    (c) => c.status === "fail" && criticalChecks.includes(c.name)
  );
  const hasAnyFailure = checks.some((c) => c.status === "fail");

  const overallStatus = hasCriticalFailure
    ? "unhealthy"
    : hasAnyFailure
      ? "degraded"
      : "healthy";

  const response = {
    status: overallStatus,
    checks,
    total_latency_ms: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response, {
    status: overallStatus === "unhealthy" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
