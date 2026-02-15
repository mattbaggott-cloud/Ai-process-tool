/**
 * Hybrid search: vector similarity + keyword matching
 * Calls the hybrid_search Postgres function via Supabase RPC
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "./client";

export interface SearchResult {
  id: string;
  sourceTable: string;
  sourceId: string;
  sourceField: string;
  chunkIndex: number;
  chunkText: string;
  metadata: Record<string, unknown>;
  similarity: number;
  textRank: number;
  combinedScore: number;
}

export interface SearchOptions {
  limit?: number;
  sourceFilter?: string[];
  vectorWeight?: number;
  textWeight?: number;
}

/**
 * Run hybrid search: embed the query, then call the Postgres
 * hybrid_search function which combines vector + keyword results.
 */
export async function hybridSearch(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  const vectorWeight = options?.vectorWeight ?? 0.7;
  const textWeight = options?.textWeight ?? 0.3;
  const sourceFilter = options?.sourceFilter ?? null;

  if (!query.trim()) return [];

  // Embed the query
  const queryEmbedding = await getEmbedding(query);

  // Call the hybrid_search Postgres function
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: JSON.stringify(queryEmbedding),
    query_text: query,
    match_user_id: userId,
    match_count: limit,
    vector_weight: vectorWeight,
    text_weight: textWeight,
    source_filter: sourceFilter,
  });

  if (error) {
    console.error("Hybrid search failed:", error);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Map to SearchResult interface
  const results: SearchResult[] = data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    sourceTable: row.source_table as string,
    sourceId: row.source_id as string,
    sourceField: row.source_field as string,
    chunkIndex: row.chunk_index as number,
    chunkText: row.chunk_text as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    similarity: row.similarity as number,
    textRank: row.text_rank as number,
    combinedScore: row.combined_score as number,
  }));

  // Deduplicate: keep highest-scoring chunk per source_id
  // If multiple chunks from the same doc, concatenate them in order
  const bySource = new Map<string, SearchResult[]>();
  for (const r of results) {
    const key = `${r.sourceTable}:${r.sourceId}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(r);
  }

  const deduped: SearchResult[] = [];
  for (const chunks of bySource.values()) {
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const best = chunks.reduce((a, b) => (a.combinedScore >= b.combinedScore ? a : b));
    // If multiple chunks, merge text
    if (chunks.length > 1) {
      best.chunkText = chunks.map((c) => c.chunkText).join("\n\n");
    }
    deduped.push(best);
  }

  // Sort by combined score descending
  deduped.sort((a, b) => b.combinedScore - a.combinedScore);

  return deduped.slice(0, limit);
}
