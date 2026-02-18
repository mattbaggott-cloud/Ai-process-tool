/**
 * Memory Retriever — fetches relevant memories for system prompt injection.
 * Uses hybrid retrieval: vector similarity + importance + recency.
 * Bumps access counts for retrieved memories.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "@/lib/embeddings/client";

/* ── Types ── */

export interface RetrievedMemory {
  id: string;
  content: string;
  memoryType: string;
  scopeType: string;
  confidence: number;
  importance: number;
  sourceType: string;
  similarity: number;
  finalScore: number;
}

/* ── Retrieval ── */

/**
 * Retrieve relevant memories for the current conversation context.
 * Returns formatted memories ready for system prompt injection.
 */
export async function retrieveMemories(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  queryText: string,
  options?: {
    limit?: number;
    minConfidence?: number;
    scopeTypes?: string[];
  }
): Promise<RetrievedMemory[]> {
  if (!queryText.trim()) return [];
  if (!process.env.OPENAI_API_KEY) return [];

  try {
    // Generate embedding for the query
    const queryEmbedding = await getEmbedding(queryText);

    // Call the retrieve_memories RPC
    const { data, error } = await supabase.rpc("retrieve_memories", {
      p_org_id: orgId,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_query_text: queryText,
      p_scope_types: options?.scopeTypes ?? ["org", "user", "team"],
      p_scope_id: userId,
      p_limit: options?.limit ?? 10,
      p_min_confidence: options?.minConfidence ?? 0.3,
    });

    if (error) {
      console.error("Memory retrieval failed:", error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Map to typed results
    const memories: RetrievedMemory[] = data.map(
      (row: Record<string, unknown>) => ({
        id: row.memory_id as string,
        content: row.content as string,
        memoryType: row.memory_type as string,
        scopeType: row.scope_type as string,
        confidence: row.confidence as number,
        importance: row.importance as number,
        sourceType: row.source_type as string,
        similarity: row.similarity as number,
        finalScore: row.final_score as number,
      })
    );

    // Bump access counts (fire-and-forget)
    const memoryIds = memories.map((m) => m.id);
    Promise.resolve(supabase.rpc("bump_memory_access", { memory_ids: memoryIds }))
      .catch((err: unknown) =>
        console.error("Memory access bump failed:", err)
      );

    return memories;
  } catch (err) {
    console.error("Memory retrieval error:", err);
    return [];
  }
}

/**
 * Format retrieved memories into a system prompt section.
 */
export function formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m) => {
    const confidence =
      m.confidence >= 0.9
        ? ""
        : ` (confidence: ${Math.round(m.confidence * 100)}%)`;
    const scope = m.scopeType === "org" ? "Org" : m.scopeType === "user" ? "Personal" : "Team";
    return `- [${scope}] ${m.content}${confidence}`;
  });

  return `## Organizational Memory
The following memories have been learned from previous conversations. Apply them directly to how you work — don't just acknowledge them, USE them. For example:
- If a memory says "User prefers EUR", format all monetary values in EUR without being asked.
- If a memory says "Sales cycle is 60 days", use that knowledge when making projections or suggestions.
- If a memory says a procedure or preference, follow it automatically.
Do NOT tell the user to go change settings when a memory already tells you their preference — just apply it.
If a memory conflicts with current data, trust the current data but note the discrepancy.

${lines.join("\n")}
`;
}
