/**
 * LLM call logging — tracks tokens, cost, latency, RAG context, tool use
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Cost constants (Claude Sonnet 4) ── */
const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;   // $3.00 per 1M input tokens
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;  // $15.00 per 1M output tokens

export interface LLMLogEntry {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retrievedChunkIds?: string[];
  toolCalls?: { name: string; success: boolean }[];
  toolRounds?: number;
  userMessage?: string;
  stopReason?: string;
  error?: string;
}

/** Calculate costs from token counts */
function calculateCosts(inputTokens: number, outputTokens: number) {
  const inputCost = inputTokens * COST_PER_INPUT_TOKEN;
  const outputCost = outputTokens * COST_PER_OUTPUT_TOKEN;
  return {
    input_cost: Math.round(inputCost * 1_000_000) / 1_000_000,
    output_cost: Math.round(outputCost * 1_000_000) / 1_000_000,
    total_cost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
  };
}

/**
 * Log an LLM call to the llm_logs table.
 * Fire-and-forget — never blocks the response.
 */
export async function logLLMCall(
  supabase: SupabaseClient,
  entry: LLMLogEntry
): Promise<void> {
  try {
    const costs = calculateCosts(entry.inputTokens, entry.outputTokens);
    const totalTokens = entry.inputTokens + entry.outputTokens;

    await supabase.from("llm_logs").insert({
      user_id: entry.userId,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      total_tokens: totalTokens,
      ...costs,
      latency_ms: entry.latencyMs,
      retrieved_chunk_ids: entry.retrievedChunkIds ?? [],
      retrieved_count: entry.retrievedChunkIds?.length ?? 0,
      tool_calls: entry.toolCalls ?? [],
      tool_rounds: entry.toolRounds ?? 0,
      user_message: entry.userMessage?.slice(0, 500),
      stop_reason: entry.stopReason,
      error: entry.error,
    });
  } catch (err) {
    // Never crash the app for logging failures
    console.error("LLM log insert failed:", err);
  }
}

/**
 * Fire-and-forget log — call this at the end of a chat request.
 */
export function logInBackground(
  supabase: SupabaseClient,
  entry: LLMLogEntry
): void {
  Promise.resolve()
    .then(() => logLLMCall(supabase, entry))
    .catch((err) => console.error("Background LLM log failed:", err));
}
