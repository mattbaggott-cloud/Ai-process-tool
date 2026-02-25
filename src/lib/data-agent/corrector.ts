/**
 * Corrector — executes SQL, validates results, self-corrects on errors
 *
 * Pipeline:
 * 1. Execute SQL via exec_safe_sql() RPC
 * 2. If error → feed error back to Generator, retry up to 3 times
 * 3. If empty → check if filters too restrictive, suggest relaxed query
 * 4. If success → extract entity IDs, extract key values, format results,
 *    save to query_history with embedding
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryPlan, QueryResult, RetrievalContext, SchemaMap } from "./types";
import { generateSQL } from "./generator";
import { formatResults, generateResultSummary } from "./formatter";
import { getEmbedding } from "../embeddings/client";

/* ── Constants ───────────────────────────────────────── */

const MAX_RETRIES = 3;

/* ── Main Corrector Function ─────────────────────────── */

/**
 * Execute SQL and handle errors with self-correction.
 */
export async function executeAndCorrect(
  sql: string,
  orgId: string,
  plan: QueryPlan,
  context: RetrievalContext,
  schemaMap: SchemaMap,
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<QueryResult> {
  let currentSql = sql;
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();

    // ── Security check: SQL must contain the literal org_id UUID ──
    // Defense in depth — catches bad SQL before it hits the database.
    // The Generator's ensureOrgIdFilter should have already injected it,
    // but if it somehow didn't, we reject here and self-correct.
    if (!currentSql.includes(orgId)) {
      console.warn(
        `[corrector] SECURITY: SQL missing org_id UUID (attempt ${attempt + 1}). Triggering self-correction.`,
        { orgId, sql: currentSql.slice(0, 200) }
      );

      if (attempt < MAX_RETRIES) {
        currentSql = await selfCorrect(
          currentSql,
          `SECURITY ERROR: The query is missing the required org_id filter. Every query MUST include org_id = '${orgId}' in the WHERE clause of the primary table. Add it now.`,
          plan,
          context,
          orgId
        );
        continue;
      }

      return {
        success: false,
        sql: currentSql,
        data: [],
        row_count: 0,
        execution_time_ms: Date.now() - startTime,
        formatted_message: "Query failed security validation — missing tenant filter.",
        error: "org_id filter missing from generated SQL",
      };
    }

    try {
      // Execute via RPC
      const { data, error } = await supabase.rpc("exec_safe_sql", {
        p_org_id: orgId,
        p_sql: currentSql,
        p_timeout_ms: 5000,
      });

      const executionTime = Date.now() - startTime;

      if (error) {
        lastError = error.message;
        console.error(
          `[corrector] SQL execution failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          error.message
        );

        if (attempt < MAX_RETRIES) {
          // Self-correct: regenerate SQL with the error message
          currentSql = await selfCorrect(
            currentSql,
            error.message,
            plan,
            context,
            orgId
          );
          continue;
        }

        // All retries exhausted — give Claude a clean message, keep raw error for logging
        return {
          success: false,
          sql: currentSql,
          data: [],
          row_count: 0,
          execution_time_ms: executionTime,
          formatted_message: "I wasn't able to retrieve that data. Try rephrasing your question or asking about a different aspect of the data.",
          error: error.message,
        };
      }

      // Parse results
      const rows = parseResults(data);

      // Empty results
      if (rows.length === 0) {
        // Save to query_history even if empty (still a valid query)
        saveQueryHistory(
          supabase,
          orgId,
          sessionId,
          plan.intent,
          currentSql,
          plan.tables_needed,
          plan.domain,
          executionTime,
          0
        );

        return {
          success: true,
          sql: currentSql,
          data: [],
          row_count: 0,
          execution_time_ms: executionTime,
          formatted_message:
            "No results found. The query executed successfully but returned no matching rows. You might want to broaden your search criteria.",
        };
      }

      // Success with data
      const formatted = formatResults(rows, schemaMap, plan.tables_needed);

      // Save to query_history (fire-and-forget)
      saveQueryHistory(
        supabase,
        orgId,
        sessionId,
        plan.intent,
        currentSql,
        plan.tables_needed,
        plan.domain,
        executionTime,
        rows.length
      );

      return {
        success: true,
        sql: currentSql,
        data: rows,
        row_count: rows.length,
        execution_time_ms: executionTime,
        formatted_message: formatted,
      };
    } catch (err) {
      const executionTime = Date.now() - startTime;
      const errorMsg =
        err instanceof Error ? err.message : "Unknown execution error";
      lastError = errorMsg;

      console.error(
        `[corrector] Unexpected error (attempt ${attempt + 1}):`,
        errorMsg
      );

      if (attempt < MAX_RETRIES) {
        try {
          currentSql = await selfCorrect(
            currentSql,
            errorMsg,
            plan,
            context,
            orgId
          );
          continue;
        } catch (corrErr) {
          console.error("[corrector] Self-correction failed:", corrErr);
        }
      }

      return {
        success: false,
        sql: currentSql,
        data: [],
        row_count: 0,
        execution_time_ms: executionTime,
        formatted_message: "I wasn't able to retrieve that data. Try rephrasing your question or asking about a different aspect of the data.",
        error: errorMsg,
      };
    }
  }

  // Should not reach here, but safety fallback
  return {
    success: false,
    sql: currentSql,
    data: [],
    row_count: 0,
    execution_time_ms: 0,
    formatted_message: "I wasn't able to retrieve that data. Try rephrasing your question or asking about a different aspect of the data.",
    error: lastError || "Unknown error",
  };
}

/* ── Self-Correction ─────────────────────────────────── */

/**
 * Regenerate SQL after an error by feeding the error back to the Generator.
 */
async function selfCorrect(
  failedSql: string,
  errorMessage: string,
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string
): Promise<string> {
  // Create a correction plan that includes the error
  const correctionPlan: QueryPlan = {
    ...plan,
    turn_type: "refinement",
    previous_sql: failedSql,
    edit_instruction: `Fix this SQL error: ${errorMessage}.

Common fixes:
- JSONB text access: use ->> (not ->) for text values
- JSONB arrays: use CROSS JOIN LATERAL jsonb_array_elements(column) AS item (not just jsonb_array_elements in SELECT)
- Numeric casting: (field->>'price')::numeric for math on JSONB values
- Table aliases: ensure every alias in SELECT/WHERE is defined in FROM/JOIN
- Column names: verify exact column names match the schema (check spelling, underscores)
- org_id: must be present in WHERE clause
- GROUP BY: all non-aggregate SELECT columns must be in GROUP BY`,
  };

  return generateSQL(correctionPlan, context, orgId);
}

/* ── Result Parsing ──────────────────────────────────── */

/**
 * Parse the raw result from exec_safe_sql into typed rows.
 */
function parseResults(data: unknown): Record<string, unknown>[] {
  if (!data) return [];

  // exec_safe_sql returns JSONB which Supabase may parse as string or object
  let parsed: unknown;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return [];
    }
  } else {
    parsed = data;
  }

  if (!Array.isArray(parsed)) return [];

  return parsed as Record<string, unknown>[];
}

/* ── Entity & Value Extraction ───────────────────────── */

/**
 * Extract entity IDs from query results.
 * Looks for columns that look like primary keys (id, customer_id, etc.)
 */
export function extractEntityIds(
  data: Record<string, unknown>[]
): string[] {
  if (data.length === 0) return [];

  const ids: string[] = [];
  const idColumns = ["id", "customer_id", "contact_id", "company_id", "deal_id"];

  for (const row of data) {
    for (const col of idColumns) {
      if (row[col] && typeof row[col] === "string") {
        ids.push(row[col] as string);
        break; // One ID per row
      }
    }
  }

  return ids;
}

/**
 * Extract key values from query results for follow-up resolution.
 * E.g., zip codes, email addresses, amounts — things the user might reference later.
 */
export function extractKeyValues(
  data: Record<string, unknown>[]
): Record<string, unknown[]> {
  if (data.length === 0) return {};

  const result: Record<string, unknown[]> = {};
  const keys = Object.keys(data[0]);

  for (const key of keys) {
    const lowerKey = key.toLowerCase();

    // Extract values for columns that users commonly reference in follow-ups
    const isExtractable =
      lowerKey.includes("zip") ||
      lowerKey.includes("city") ||
      lowerKey.includes("province") ||
      lowerKey.includes("state") ||
      lowerKey.includes("country") ||
      lowerKey.includes("email") ||
      lowerKey.includes("name") ||
      lowerKey.includes("stage") ||
      lowerKey.includes("status") ||
      lowerKey.includes("type") ||
      lowerKey.includes("category");

    if (isExtractable) {
      const values = data
        .map((row) => row[key])
        .filter((v) => v !== null && v !== undefined);

      if (values.length > 0) {
        result[key] = values;
      }
    }
  }

  return result;
}

/* ── Query History Storage ───────────────────────────── */

/**
 * Save a successful query to query_history for self-learning.
 * Fire-and-forget — never blocks the response.
 */
function saveQueryHistory(
  supabase: SupabaseClient,
  orgId: string,
  sessionId: string,
  question: string,
  sql: string,
  tables: string[],
  domain: string,
  executionTimeMs: number,
  rowCount: number
): void {
  Promise.resolve()
    .then(async () => {
      // Generate embedding for similarity search
      const embedding = await getEmbedding(question);

      await supabase.from("query_history").insert({
        org_id: orgId,
        session_id: sessionId,
        question,
        sql,
        tables_used: tables,
        domain,
        execution_time_ms: executionTimeMs,
        row_count: rowCount,
        embedding: JSON.stringify(embedding),
        verified: true,
      });
    })
    .catch((err) =>
      console.error("[corrector] Failed to save query history:", err)
    );
}
