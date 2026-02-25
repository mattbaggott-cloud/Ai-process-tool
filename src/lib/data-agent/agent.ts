/**
 * Agent Orchestrator — the main pipeline function
 *
 * analyzeData() is the single entry point for all data questions.
 * It orchestrates:
 *
 * 0. Schema indexing (one-time per org)
 * 1. Session state (get or create)
 * 2. Semantic layer (load)
 * 3. PLAN — classify intent, detect ambiguity, resolve references
 * 3b. DECOMPOSE — check if question needs multiple sub-queries
 * 3c. CLARIFY — structured clarification if needed
 * 4. RETRIEVE — gather schema, semantic matches, few-shot examples
 * 5. GENERATE — create or edit SQL
 * 6. CORRECT — execute, validate, self-fix, format
 * 7. STITCH — merge sub-query results (multi-query path only)
 * 8. PRESENT — row count validation, presentation classification, structured output
 * 9. Update session state
 *
 * Two execution paths:
 * - Single-query: steps 4→5→6→8 (unchanged from Phase 2)
 * - Multi-query: steps 3b→4→5→6 per sub-query → 7→8
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryResult, StageTimings, DecomposedPlan, RetrievalContext } from "./types";
import { getSchemaMap } from "./schema-introspect";
import { ensureSchemaIndexed } from "./schema-indexer";
import { loadSemanticLayer, getFieldConfidence } from "./semantic-layer";
import { getSession, updateSession } from "./session";
import { planQuery, buildStructuredClarification } from "./planner";
import { retrieveContext, prefetchSchemaContext } from "./retriever";
import { generateSQL, generateSubQuerySQL } from "./generator";
import { executeAndCorrect, extractEntityIds, extractKeyValues } from "./corrector";
import { generateResultSummary } from "./formatter";
import { presentResults } from "./presenter";
import { tryDecompose } from "./decomposer";
import { stitchResults, type SubQueryResult } from "./stitcher";
import { syncRecordToGraph } from "@/lib/agentic/graph-sync";

/* ── Graph Backfill (auto-detect & self-heal) ────────── */

/** Orgs we've already verified have graph data. Resets on server restart. */
const backfilledOrgs = new Set<string>();

/** Tables that should have graph_nodes entries when data exists. */
const GRAPH_SYNCABLE_TABLES = [
  "ecom_customers",
  "ecom_orders",
  "ecom_products",
  "crm_contacts",
  "crm_companies",
  "crm_deals",
  "crm_activities",
];

/**
 * Auto-detect tables with data but no graph nodes and backfill them.
 * Runs once per org per server lifecycle — after that it's a no-op.
 * The post-import hook in ImportsTab handles all future imports.
 */
async function ensureGraphBackfill(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<void> {
  if (backfilledOrgs.has(orgId)) return;
  backfilledOrgs.add(orgId); // Mark early to prevent concurrent runs

  try {
    for (const table of GRAPH_SYNCABLE_TABLES) {
      // Check if table has records but no graph nodes
      const [recordCount, nodeCount] = await Promise.all([
        supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .then((r) => r.count || 0),
        supabase
          .from("graph_nodes")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("entity_type", table)
          .then((r) => r.count || 0),
      ]);

      if (recordCount > 0 && nodeCount === 0) {
        console.log(
          `[data-agent] Auto-backfill: ${table} has ${recordCount} records but 0 graph nodes. Syncing...`
        );

        // Fetch and sync in batches of 50
        let offset = 0;
        const batchSize = 50;
        let synced = 0;

        while (offset < recordCount) {
          const { data: records } = await supabase
            .from(table)
            .select("*")
            .eq("org_id", orgId)
            .range(offset, offset + batchSize - 1);

          if (!records || records.length === 0) break;

          for (const record of records) {
            try {
              await syncRecordToGraph(supabase, orgId, table, record.id, record, userId);
              synced++;
            } catch {
              // Non-fatal — continue with remaining records
            }
          }

          offset += batchSize;

          // Small delay between batches
          if (offset < recordCount) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        console.log(`[data-agent] Auto-backfill: ${table} — synced ${synced}/${recordCount}`);
      }
    }
  } catch (err) {
    console.error("[data-agent] Auto-backfill error (non-fatal):", err);
    // Don't remove from backfilledOrgs — we'll retry next server restart
  }
}

/* ── Main Entry Point ────────────────────────────────── */

/**
 * Analyze a data question.
 *
 * This is the ONLY function the copilot calls.
 * It handles everything: schema discovery, SQL generation,
 * self-correction, formatting, session state, and learning.
 */
export async function analyzeData(
  question: string,
  sessionId: string,
  orgId: string,
  supabase: SupabaseClient,
  userId: string
): Promise<QueryResult> {
  const startTime = Date.now();

  // Per-stage timing — each stage gets a start/end measurement
  const timings: StageTimings = {
    schema_ms: 0,
    plan_ms: 0,
    retrieve_ms: 0,
    generate_ms: 0,
    correct_ms: 0,
    present_ms: 0,
    total_ms: 0,
  };

  try {
    // ── 0. Ensure schema is indexed + graph data is connected (one-time per org) ──
    let stageStart = Date.now();
    const schemaMap = await getSchemaMap(supabase, orgId);
    await Promise.all([
      ensureSchemaIndexed(supabase, orgId, userId, schemaMap),
      ensureGraphBackfill(supabase, orgId, userId),
    ]);
    timings.schema_ms = Date.now() - stageStart;

    // ── 1. Get or create session ──
    const session = getSession(sessionId, orgId);

    // ── 2. Load semantic layer ──
    const semanticLayer = loadSemanticLayer();

    // ── 3. PLAN + SCHEMA PRE-FETCH (parallel) ──
    stageStart = Date.now();
    const [plan, preloadedSchemaContext] = await Promise.all([
      planQuery(
        question,
        session,
        semanticLayer,
        schemaMap,
        supabase,
        orgId,
        userId
      ),
      prefetchSchemaContext(question, supabase, userId),
    ]);
    timings.plan_ms = Date.now() - stageStart;

    console.log("[data-agent] Plan:", JSON.stringify({
      turn_type: plan.turn_type,
      intent: plan.intent,
      domain: plan.domain,
      ambiguous: plan.ambiguous,
      tables_needed: plan.tables_needed,
    }));

    // ── 3b. If ambiguous, check for structured clarification ──
    if (plan.ambiguous && plan.needs_clarification) {
      const structured = buildStructuredClarification(question, plan, semanticLayer);
      if (structured) {
        plan.structured_clarification = structured;
      }

      timings.total_ms = Date.now() - startTime;
      return {
        success: true,
        sql: "",
        data: [],
        row_count: 0,
        execution_time_ms: Date.now() - startTime,
        formatted_message: plan.needs_clarification,
        needs_clarification: true,
        stage_timings: timings,
      };
    }

    // ── 3c. DECOMPOSE — check if question needs multiple sub-queries ──
    stageStart = Date.now();
    const decomposed = await tryDecompose(question, plan, semanticLayer, schemaMap);
    timings.decompose_ms = Date.now() - stageStart;

    if (decomposed) {
      console.log("[data-agent] Decomposed:", JSON.stringify({
        sub_queries: decomposed.sub_queries.length,
        stitch_strategy: decomposed.stitch_strategy,
        stitch_key: decomposed.stitch_key,
      }));
      plan.decomposed = decomposed;

      // Check if multi-part clarification is needed (3+ sub-queries)
      const clarification = buildStructuredClarification(question, plan, semanticLayer, decomposed);
      if (clarification) {
        plan.structured_clarification = clarification;
        timings.total_ms = Date.now() - startTime;
        return {
          success: true,
          sql: "",
          data: [],
          row_count: 0,
          execution_time_ms: Date.now() - startTime,
          formatted_message: clarification.question,
          needs_clarification: true,
          stage_timings: timings,
        };
      }

      // Execute the decomposed plan
      const result = await executeDecomposedPlan(
        decomposed, plan, question, schemaMap, semanticLayer,
        supabase, orgId, userId, sessionId, preloadedSchemaContext,
        session, timings, startTime
      );
      return result;
    }

    // ── SINGLE-QUERY PATH (unchanged from Phase 2) ──

    // ── 4. RETRIEVE ──
    stageStart = Date.now();
    const context = await retrieveContext(
      plan, session, semanticLayer, schemaMap,
      supabase, orgId, userId, preloadedSchemaContext
    );
    timings.retrieve_ms = Date.now() - stageStart;

    // ── 5. GENERATE ──
    stageStart = Date.now();
    const sql = await generateSQL(plan, context, orgId, semanticLayer);
    timings.generate_ms = Date.now() - stageStart;
    console.log("[data-agent] Generated SQL:", sql);

    // ── 6. CORRECT ──
    stageStart = Date.now();
    const result = await executeAndCorrect(
      sql, orgId, plan, context, schemaMap,
      supabase, userId, sessionId
    );
    timings.correct_ms = Date.now() - stageStart;

    console.log("[data-agent] Result:", JSON.stringify({
      success: result.success,
      row_count: result.row_count,
      execution_time_ms: result.execution_time_ms,
    }));

    // ── 7. CONFIDENCE — attach field confidence metadata ──
    if (result.success && result.data.length > 0) {
      const columns = Object.keys(result.data[0]);
      const confidence = getFieldConfidence(plan.tables_needed, columns, semanticLayer);
      if (confidence.length > 0) {
        result.field_confidence = confidence;
      }
    }

    // ── 8. PRESENT ──
    stageStart = Date.now();
    const presentation = presentResults(result, plan, schemaMap);

    if (presentation.needsRetry && presentation.reason) {
      console.log("[data-agent] Presenter requesting retry:", presentation.reason);
      const retryGenerateStart = Date.now();
      const correctedPlan = {
        ...plan,
        turn_type: "refinement" as const,
        previous_sql: result.sql,
        edit_instruction: presentation.reason,
      };
      const correctedSql = await generateSQL(correctedPlan, context, orgId);
      timings.generate_ms += Date.now() - retryGenerateStart;

      const retryCorrectStart = Date.now();
      const correctedResult = await executeAndCorrect(
        correctedSql, orgId, correctedPlan, context, schemaMap,
        supabase, userId, sessionId
      );
      timings.correct_ms += Date.now() - retryCorrectStart;

      presentResults(correctedResult, plan, schemaMap);
      timings.present_ms = Date.now() - stageStart;

      if (correctedResult.success && correctedResult.data.length > 0) {
        updateSession(session, {
          question,
          sql: correctedResult.sql,
          tables: plan.tables_needed,
          domain: plan.domain,
          entity_ids: extractEntityIds(correctedResult.data),
          result_values: extractKeyValues(correctedResult.data),
          result_summary: generateResultSummary(correctedResult.data, question).slice(0, 200),
          timestamp: Date.now(),
        });
      }

      timings.total_ms = Date.now() - startTime;
      correctedResult.stage_timings = timings;
      return correctedResult;
    }

    timings.present_ms = Date.now() - stageStart;

    console.log("[data-agent] Presentation:", JSON.stringify({
      has_viz: !!result.visualization,
      viz_type: result.visualization?.type,
      chart_type: result.visualization?.chart_type,
    }));

    // ── 9. Update session state ──
    if (result.success && result.data.length > 0) {
      updateSession(session, {
        question,
        sql: result.sql,
        tables: plan.tables_needed,
        domain: plan.domain,
        entity_ids: extractEntityIds(result.data),
        result_values: extractKeyValues(result.data),
        result_summary: generateResultSummary(result.data, question).slice(0, 200),
        timestamp: Date.now(),
      });
    }

    timings.total_ms = Date.now() - startTime;
    result.stage_timings = timings;
    console.log("[data-agent] Timings:", JSON.stringify(timings));
    return result;
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Unknown error in data agent";
    console.error("[data-agent] Pipeline error:", errorMsg);

    timings.total_ms = Date.now() - startTime;
    return {
      success: false,
      sql: "",
      data: [],
      row_count: 0,
      execution_time_ms: Date.now() - startTime,
      formatted_message: `I encountered an error analyzing your data: ${errorMsg}. Please try rephrasing your question.`,
      error: errorMsg,
      stage_timings: timings,
    };
  }
}

/* ── Multi-Query Execution ────────────────────────────── */

/**
 * Execute a decomposed plan: run each sub-query through the pipeline,
 * then stitch results together.
 *
 * Sub-queries are executed in topological order (dependencies first).
 * Entity IDs from anchor queries are injected into dependent queries.
 */
async function executeDecomposedPlan(
  decomposed: DecomposedPlan,
  plan: import("./types").QueryPlan,
  question: string,
  schemaMap: import("./types").SchemaMap,
  semanticLayer: import("./types").SemanticLayer,
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  sessionId: string,
  preloadedSchemaContext: string | undefined,
  session: import("./types").DataAgentSession,
  timings: StageTimings,
  startTime: number
): Promise<QueryResult> {
  const subResults: SubQueryResult[] = [];
  const entityIdCache = new Map<string, string[]>(); // sq_id → entity IDs

  // Topological sort: anchor first, then dependents
  const sorted = topologicalSort(decomposed.sub_queries);

  for (const subQuery of sorted) {
    try {
      // Build a plan for this sub-query
      const subPlan = {
        ...plan,
        intent: subQuery.intent,
        tables_needed: subQuery.tables_needed,
        domain: subQuery.domain,
        resolved_references: { ...subQuery.resolved_references },
      };

      // Inject entity IDs from dependencies
      if (subQuery.depends_on) {
        for (const depId of subQuery.depends_on) {
          const ids = entityIdCache.get(depId);
          if (ids && ids.length > 0) {
            subPlan.resolved_references["_entity_ids"] = ids;
          }
        }
      }

      // RETRIEVE
      let retrieveStart = Date.now();
      const context = await retrieveContext(
        subPlan, session, semanticLayer, schemaMap,
        supabase, orgId, userId, preloadedSchemaContext
      );
      timings.retrieve_ms += Date.now() - retrieveStart;

      // GENERATE
      let generateStart = Date.now();
      const sql = await generateSubQuerySQL(
        subQuery, context, orgId, entityIdCache, semanticLayer
      );
      timings.generate_ms += Date.now() - generateStart;

      console.log(`[data-agent] Sub-query ${subQuery.id} SQL:`, sql);

      // CORRECT
      let correctStart = Date.now();
      const result = await executeAndCorrect(
        sql, orgId, subPlan, context, schemaMap,
        supabase, userId, sessionId
      );
      timings.correct_ms += Date.now() - correctStart;

      console.log(`[data-agent] Sub-query ${subQuery.id} result:`, JSON.stringify({
        success: result.success,
        row_count: result.row_count,
      }));

      // Cache entity IDs for dependent queries
      if (result.success && result.data.length > 0) {
        const ids = extractEntityIds(result.data);
        entityIdCache.set(subQuery.id, ids);
      }

      subResults.push({ id: subQuery.id, result, subQuery });
    } catch (err) {
      console.error(`[data-agent] Sub-query ${subQuery.id} failed:`, err);
      subResults.push({
        id: subQuery.id,
        result: {
          success: false,
          sql: "",
          data: [],
          row_count: 0,
          execution_time_ms: 0,
          formatted_message: `Sub-query ${subQuery.id} failed`,
          error: err instanceof Error ? err.message : "Unknown error",
        },
        subQuery,
      });
    }
  }

  // STITCH results together
  let stitchStart = Date.now();
  const stitched = stitchResults(subResults, decomposed);
  timings.stitch_ms = Date.now() - stitchStart;

  console.log("[data-agent] Stitched:", JSON.stringify({
    success: stitched.success,
    row_count: stitched.row_count,
    sub_results: subResults.length,
  }));

  // Attach confidence metadata
  if (stitched.success && stitched.data.length > 0) {
    const allTables = decomposed.sub_queries.flatMap((sq) => sq.tables_needed);
    const columns = Object.keys(stitched.data[0]);
    const confidence = getFieldConfidence(allTables, columns, semanticLayer);
    if (confidence.length > 0) {
      stitched.field_confidence = confidence;
    }
  }

  // PRESENT
  let presentStart = Date.now();
  presentResults(stitched, plan, schemaMap);
  timings.present_ms = Date.now() - presentStart;

  // Update session
  if (stitched.success && stitched.data.length > 0) {
    const allTables = decomposed.sub_queries.flatMap((sq) => sq.tables_needed);
    updateSession(session, {
      question,
      sql: stitched.sql,
      tables: [...new Set(allTables)],
      domain: plan.domain,
      entity_ids: extractEntityIds(stitched.data),
      result_values: extractKeyValues(stitched.data),
      result_summary: generateResultSummary(stitched.data, question).slice(0, 200),
      timestamp: Date.now(),
    });
  }

  timings.total_ms = Date.now() - startTime;
  stitched.stage_timings = timings;
  console.log("[data-agent] Timings (multi-query):", JSON.stringify(timings));
  return stitched;
}

/* ── Topological Sort ─────────────────────────────────── */

/**
 * Sort sub-queries by dependency order.
 * Anchor queries (no dependencies) first, then dependent queries.
 */
function topologicalSort(subQueries: import("./types").SubQuery[]): import("./types").SubQuery[] {
  const sorted: import("./types").SubQuery[] = [];
  const visited = new Set<string>();

  function visit(sq: import("./types").SubQuery) {
    if (visited.has(sq.id)) return;
    visited.add(sq.id);

    // Visit dependencies first
    if (sq.depends_on) {
      for (const depId of sq.depends_on) {
        const dep = subQueries.find((s) => s.id === depId);
        if (dep) visit(dep);
      }
    }

    sorted.push(sq);
  }

  for (const sq of subQueries) {
    visit(sq);
  }

  return sorted;
}
