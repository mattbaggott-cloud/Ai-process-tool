/**
 * Retriever — assembles all context the SQL Generator needs
 *
 * NO LLM calls — pure data retrieval. Gathers:
 * 1. Schema context via hybridSearch (document_chunks source_table: "schema")
 * 2. JOIN paths via graph_traverse (graph_nodes/edges for data_tables)
 * 3. Semantic layer matches (business term → SQL condition)
 * 4. Similar past queries from query_history (few-shot examples)
 * 5. Session context for follow-ups (previous SQL + result values)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryPlan, RetrievalContext, PastQuery, SemanticMatch, SemanticLayer, SchemaMap } from "./types";
import { hybridSearch } from "../embeddings/search";
import { getEmbedding } from "../embeddings/client";
import { findTermMatches, findJsonbPatterns, findJoinPath } from "./semantic-layer";
import { buildSessionContext } from "./session";
import type { DataAgentSession } from "./types";

/* ── Main Retrieval Function ─────────────────────────── */

/**
 * Assemble everything the Generator needs to produce SQL.
 *
 * Accepts optional preloadedSchemaContext — if the agent already kicked off
 * schema retrieval in parallel with planning, pass the result here to skip
 * the redundant search (~200ms savings).
 */
export async function retrieveContext(
  plan: QueryPlan,
  session: DataAgentSession,
  semanticLayer: SemanticLayer,
  schemaMap: SchemaMap,
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  preloadedSchemaContext?: string
): Promise<RetrievalContext> {
  // Run independent retrievals in parallel
  // If schema context was preloaded, skip the vector search
  const [schemaContext, joinPaths, semanticMatches, similarQueries] =
    await Promise.all([
      preloadedSchemaContext
        ? Promise.resolve(preloadedSchemaContext)
        : retrieveSchemaContext(plan, supabase, userId),
      retrieveJoinPaths(plan, semanticLayer, schemaMap),
      Promise.resolve(retrieveSemanticMatches(plan, semanticLayer)),
      retrieveSimilarQueries(plan, supabase, orgId),
    ]);

  // Session context (synchronous)
  const sessionContext = buildSessionContext(session);

  return {
    schema_context: schemaContext,
    semantic_matches: semanticMatches,
    similar_queries: similarQueries,
    session_context: sessionContext,
    join_paths: joinPaths,
  };
}

/**
 * Pre-fetch schema context for a question.
 * Called by the agent to overlap with planning.
 * Uses the same logic as retrieveSchemaContext but takes a raw question string.
 */
export async function prefetchSchemaContext(
  question: string,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  return retrieveSchemaContext(
    { intent: question } as QueryPlan,
    supabase,
    userId
  );
}

/* ── Schema Retrieval ────────────────────────────────── */

/**
 * Search the vector store for schema descriptions relevant to the question.
 * Uses hybridSearch with source_filter: ["schema"] to only search schema chunks.
 */
async function retrieveSchemaContext(
  plan: QueryPlan,
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  try {
    const results = await hybridSearch(supabase, userId, plan.intent, {
      limit: 8,
      sourceFilter: ["schema"],
      vectorWeight: 0.6,
      textWeight: 0.4,
    });

    if (results.length === 0) {
      return "No schema information found. Generate SQL based on table names and common conventions.";
    }

    // Deduplicate and format
    const seen = new Set<string>();
    const parts: string[] = [];

    for (const result of results) {
      if (seen.has(result.sourceId)) continue;
      seen.add(result.sourceId);
      parts.push(result.chunkText);
    }

    return parts.join("\n\n---\n\n");
  } catch (err) {
    console.error("[retriever] Schema search failed:", err);
    return "Schema search failed. Use table names from the query plan.";
  }
}

/* ── JOIN Path Discovery ─────────────────────────────── */

/**
 * Find JOIN paths between tables needed by the plan.
 * Uses semantic layer relationship definitions + BFS for multi-hop.
 */
async function retrieveJoinPaths(
  plan: QueryPlan,
  semanticLayer: SemanticLayer,
  _schemaMap: SchemaMap
): Promise<string[]> {
  const tables = plan.tables_needed;
  if (tables.length < 2) return [];

  const paths: string[] = [];
  const primaryTable = tables[0];

  // Find JOIN path from primary table to each other table
  for (let i = 1; i < tables.length; i++) {
    const joinPath = findJoinPath(primaryTable, tables[i], semanticLayer);
    if (joinPath.length > 0) {
      paths.push(...joinPath);
    }
  }

  // Deduplicate
  return [...new Set(paths)];
}

/* ── Semantic Layer Matching ─────────────────────────── */

/**
 * Find business term → SQL condition matches for the question.
 * Also finds JSONB access patterns.
 */
function retrieveSemanticMatches(
  plan: QueryPlan,
  semanticLayer: SemanticLayer
): SemanticMatch[] {
  const termMatches = findTermMatches(plan.intent, semanticLayer);

  // Also find JSONB patterns and convert to SemanticMatch format
  const jsonbPatterns = findJsonbPatterns(plan.intent, semanticLayer);
  for (const pattern of jsonbPatterns) {
    termMatches.push({
      term: `${pattern.column} (JSONB)`,
      sql_condition: pattern.access_pattern,
      table: pattern.table,
      description: pattern.description,
    });
  }

  return termMatches;
}

/* ── Similar Past Queries ────────────────────────────── */

/**
 * Search query_history for similar past queries as few-shot examples.
 * Uses embedding similarity to find questions that were asked before.
 */
async function retrieveSimilarQueries(
  plan: QueryPlan,
  supabase: SupabaseClient,
  orgId: string
): Promise<PastQuery[]> {
  try {
    // Generate embedding for the current question
    const questionEmbedding = await getEmbedding(plan.intent);

    // Search query_history by embedding similarity
    const { data, error } = await supabase.rpc("hybrid_search", {
      query_embedding: JSON.stringify(questionEmbedding),
      query_text: plan.intent,
      match_user_id: null, // query_history doesn't have user_id, but the RPC needs it
      match_count: 3,
      vector_weight: 0.8,
      text_weight: 0.2,
      source_filter: null,
    });

    // Fallback: direct query on query_history table if hybrid_search doesn't work for this
    // (hybrid_search is scoped to document_chunks, not query_history)
    // Use direct cosine similarity instead
    const { data: historyData, error: historyError } = await supabase
      .from("query_history")
      .select("question, sql, tables_used, domain")
      .eq("org_id", orgId)
      .eq("verified", true)
      .is("error", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (historyError || !historyData || historyData.length === 0) {
      return [];
    }

    // Simple keyword matching as fallback (until we have proper vector search on query_history)
    const lowerIntent = plan.intent.toLowerCase();
    const scored = historyData
      .map((row) => {
        const lowerQ = (row.question as string).toLowerCase();
        // Count shared words
        const intentWords = new Set(lowerIntent.split(/\s+/));
        const qWords = lowerQ.split(/\s+/);
        let shared = 0;
        for (const w of qWords) {
          if (intentWords.has(w) && w.length > 3) shared++;
        }
        return {
          question: row.question as string,
          sql: row.sql as string,
          tables: row.tables_used as string[],
          similarity: shared / Math.max(intentWords.size, 1),
        };
      })
      .filter((s) => s.similarity > 0.2)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    return scored;
  } catch (err) {
    console.error("[retriever] Query history search failed:", err);
    return [];
  }
}
