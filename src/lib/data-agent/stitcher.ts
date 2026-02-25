/**
 * Result Stitcher — merges results from multiple sub-queries
 *
 * Three strategies:
 * - merge_columns: LEFT JOIN by stitch_key (different columns, same entities)
 * - nested: Parent rows get child arrays (one-to-many data like products)
 * - append_rows: Concatenate rows (rare — different entity types)
 *
 * Pure code — no LLM, no DB calls.
 */

import type { QueryResult, DecomposedPlan, SubQuery } from "./types";

/* ── Types ────────────────────────────────────────────── */

export interface SubQueryResult {
  id: string;
  result: QueryResult;
  subQuery: SubQuery;
}

/* ── Main Entry Point ────────────────────────────────── */

/**
 * Stitch multiple sub-query results into a single unified QueryResult.
 */
export function stitchResults(
  subResults: SubQueryResult[],
  plan: DecomposedPlan
): QueryResult {
  if (subResults.length === 0) {
    return emptyResult("No sub-query results to stitch");
  }

  if (subResults.length === 1) {
    return subResults[0].result;
  }

  // Filter to successful results only
  const successful = subResults.filter((sr) => sr.result.success);
  if (successful.length === 0) {
    const errors = subResults
      .filter((sr) => sr.result.error)
      .map((sr) => `${sr.id}: ${sr.result.error}`)
      .join("; ");
    return emptyResult(`All sub-queries failed: ${errors}`);
  }

  switch (plan.stitch_strategy) {
    case "merge_columns":
      return mergeColumns(successful, plan.stitch_key);
    case "nested":
      return nestResults(successful, plan.stitch_key);
    case "append_rows":
      return appendRows(successful);
    default:
      return mergeColumns(successful, plan.stitch_key);
  }
}

/* ── Strategy: merge_columns ──────────────────────────── */

/**
 * LEFT JOIN sub-query results by stitch_key.
 * sq_1: [{id, name, spend}]
 * sq_2: [{customer_id, city, zip}]
 * → [{id, name, spend, city, zip}]
 */
function mergeColumns(
  subResults: SubQueryResult[],
  stitchKey: string
): QueryResult {
  const anchor = subResults[0];
  const anchorData = anchor.result.data;

  if (anchorData.length === 0) {
    return {
      ...anchor.result,
      sub_results: subResults.map((sr) => sr.result),
      stitch_key: stitchKey,
    };
  }

  // Build lookup maps for each non-anchor result
  const lookups: Array<Map<string, Record<string, unknown>>> = [];
  for (let i = 1; i < subResults.length; i++) {
    const sr = subResults[i];
    const joinKey = sr.subQuery.join_key || stitchKey;
    const map = new Map<string, Record<string, unknown>>();

    for (const row of sr.result.data) {
      const key = String(row[joinKey] ?? "");
      if (key) {
        map.set(key, row);
      }
    }
    lookups.push(map);
  }

  // Merge: for each anchor row, pull matching data from other results
  const merged: Record<string, unknown>[] = anchorData.map((anchorRow) => {
    const key = String(anchorRow[stitchKey] ?? "");
    const result: Record<string, unknown> = { ...anchorRow };

    for (const lookup of lookups) {
      const match = lookup.get(key);
      if (match) {
        // Merge columns, skipping the join key to avoid duplicates
        for (const [col, val] of Object.entries(match)) {
          if (!(col in result)) {
            result[col] = val;
          }
        }
      }
    }

    return result;
  });

  // Combine SQL from all sub-queries
  const combinedSql = subResults.map((sr) => `-- ${sr.id}\n${sr.result.sql}`).join("\n\n");
  const totalExecTime = subResults.reduce((sum, sr) => sum + sr.result.execution_time_ms, 0);

  return {
    success: true,
    sql: combinedSql,
    data: merged,
    row_count: merged.length,
    execution_time_ms: totalExecTime,
    formatted_message: "",
    sub_results: subResults.map((sr) => sr.result),
    stitch_key: stitchKey,
  };
}

/* ── Strategy: nested ─────────────────────────────────── */

/**
 * Nest child results as arrays within parent rows.
 * sq_1: [{id, name, spend}]
 * sq_2: [{customer_id, product, count}] (multiple rows per customer)
 * → [{id, name, spend, _products: [{product, count}, ...]}]
 */
function nestResults(
  subResults: SubQueryResult[],
  stitchKey: string
): QueryResult {
  const anchor = subResults[0];
  const anchorData = anchor.result.data;

  if (anchorData.length === 0) {
    return {
      ...anchor.result,
      sub_results: subResults.map((sr) => sr.result),
      stitch_key: stitchKey,
    };
  }

  // Build grouped lookups for non-anchor results (one-to-many)
  const groupedLookups: Array<{
    key: string;
    label: string;
    groups: Map<string, Record<string, unknown>[]>;
  }> = [];

  for (let i = 1; i < subResults.length; i++) {
    const sr = subResults[i];
    const joinKey = sr.subQuery.join_key || stitchKey;
    const groups = new Map<string, Record<string, unknown>[]>();

    for (const row of sr.result.data) {
      const key = String(row[joinKey] ?? "");
      if (key) {
        const existing = groups.get(key) || [];
        // Remove the join key from nested data to keep it clean
        const cleanRow = { ...row };
        delete cleanRow[joinKey];
        existing.push(cleanRow);
        groups.set(key, existing);
      }
    }

    // Generate label from sub-query intent
    const label = `_${sr.id}_data`;

    groupedLookups.push({ key: joinKey, label, groups });
  }

  // Nest: for each anchor row, attach child arrays
  const nested: Record<string, unknown>[] = anchorData.map((anchorRow) => {
    const key = String(anchorRow[stitchKey] ?? "");
    const result: Record<string, unknown> = { ...anchorRow };

    for (const lookup of groupedLookups) {
      result[lookup.label] = lookup.groups.get(key) || [];
    }

    return result;
  });

  const combinedSql = subResults.map((sr) => `-- ${sr.id}\n${sr.result.sql}`).join("\n\n");
  const totalExecTime = subResults.reduce((sum, sr) => sum + sr.result.execution_time_ms, 0);

  return {
    success: true,
    sql: combinedSql,
    data: nested,
    row_count: nested.length,
    execution_time_ms: totalExecTime,
    formatted_message: "",
    sub_results: subResults.map((sr) => sr.result),
    stitch_key: stitchKey,
  };
}

/* ── Strategy: append_rows ────────────────────────────── */

/**
 * Concatenate all rows from all sub-queries.
 * Used when sub-queries return different entity types.
 */
function appendRows(subResults: SubQueryResult[]): QueryResult {
  const allData: Record<string, unknown>[] = [];

  for (const sr of subResults) {
    for (const row of sr.result.data) {
      allData.push({ ...row, _source_query: sr.id });
    }
  }

  const combinedSql = subResults.map((sr) => `-- ${sr.id}\n${sr.result.sql}`).join("\n\n");
  const totalExecTime = subResults.reduce((sum, sr) => sum + sr.result.execution_time_ms, 0);

  return {
    success: true,
    sql: combinedSql,
    data: allData,
    row_count: allData.length,
    execution_time_ms: totalExecTime,
    formatted_message: "",
    sub_results: subResults.map((sr) => sr.result),
  };
}

/* ── Helpers ──────────────────────────────────────────── */

function emptyResult(error: string): QueryResult {
  return {
    success: false,
    sql: "",
    data: [],
    row_count: 0,
    execution_time_ms: 0,
    formatted_message: `Unable to complete analysis: ${error}`,
    error,
  };
}
