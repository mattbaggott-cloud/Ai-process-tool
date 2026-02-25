/**
 * Question Decomposer — schema-driven, LLM-powered decomposition
 *
 * Decides when a single SQL query isn't enough by using Haiku
 * to analyze the question against the actual schema. No hardcoded
 * patterns — works with any database schema.
 *
 * The LLM already knows what tables exist, their columns, JSONB
 * structures, and relationships because we feed it the schema map
 * and semantic layer. It decides whether to decompose based on
 * actual data structure, not regex.
 *
 * Rules (code-enforced post-LLM):
 * - Max 4 sub-queries per decomposition
 * - Every sub-query MUST have a join_key
 * - Returns null if single query suffices
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  QueryPlan,
  SemanticLayer,
  SchemaMap,
  DecomposedPlan,
  SubQuery,
  TableSchema,
} from "./types";

/* ── Constants ───────────────────────────────────────── */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_SUB_QUERIES = 4;

/* ── Main Entry Point ────────────────────────────────── */

/**
 * Try to decompose a question into multiple sub-queries.
 * Returns null if a single query suffices.
 *
 * Uses Haiku to analyze the question against the actual schema.
 * Schema-driven — works with any database, not just our current tables.
 */
export async function tryDecompose(
  question: string,
  plan: QueryPlan,
  semanticLayer: SemanticLayer,
  schemaMap: SchemaMap
): Promise<DecomposedPlan | null> {
  // ── Guard: Never decompose clarification questions ──
  if (plan.ambiguous || plan.needs_clarification) {
    return null;
  }

  // ── Guard: Single table, simple columns → single query is fine ──
  // But only skip if the table has no JSONB array columns that might
  // need unnesting alongside other data requests.
  if (plan.tables_needed.length <= 1) {
    const table = schemaMap.tables.get(plan.tables_needed[0]);
    const hasJsonbArrays = table?.columns.some(
      (c) => c.type === "jsonb" && isArrayColumn(c.name)
    );
    if (!hasJsonbArrays) {
      return null;
    }
  }

  // ── LLM-driven decomposition ──
  try {
    return await decomposeWithLLM(question, plan, semanticLayer, schemaMap);
  } catch (err) {
    console.error("[decomposer] LLM decomposition failed:", err);
    return null; // Fallback: single query
  }
}

/* ── LLM Decomposition ───────────────────────────────── */

/**
 * Use Haiku to analyze whether a question needs decomposition.
 * Haiku sees the actual schema and decides based on data structure.
 */
async function decomposeWithLLM(
  question: string,
  plan: QueryPlan,
  semanticLayer: SemanticLayer,
  schemaMap: SchemaMap
): Promise<DecomposedPlan | null> {
  const prompt = buildDecomposerPrompt(plan, semanticLayer, schemaMap);

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: prompt,
    messages: [
      {
        role: "user",
        content: question,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Parse response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[decomposer] No JSON in response:", text);
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // If LLM says single query is fine
  if (parsed.decompose === false || !parsed.sub_queries || parsed.sub_queries.length <= 1) {
    return null;
  }

  // Validate and enforce constraints
  return validateAndBuild(parsed, plan);
}

/**
 * Build the decomposer prompt from actual schema data.
 * The LLM sees real tables, columns, types, and relationships.
 */
function buildDecomposerPrompt(
  plan: QueryPlan,
  semanticLayer: SemanticLayer,
  schemaMap: SchemaMap
): string {
  // Build schema summary from actual data
  const schemaLines: string[] = [];
  for (const table of schemaMap.tables.values()) {
    if (isInfrastructureTable(table.name)) continue;
    schemaLines.push(formatTableForPrompt(table));
  }

  // Build relationship summary
  const relLines: string[] = [];
  for (const rel of semanticLayer.relationships) {
    relLines.push(`  ${rel.from_table} → ${rel.to_table}: ${rel.join_sql}`);
  }

  // Build JSONB patterns
  const jsonbLines: string[] = [];
  for (const jp of semanticLayer.jsonb_patterns) {
    jsonbLines.push(`  ${jp.table}.${jp.column}: ${jp.description}`);
  }

  return `You are a query decomposition analyzer for a multi-tenant data platform.

Given a user question, decide whether it needs ONE SQL query or MULTIPLE separate queries.

## When to decompose (return multiple sub-queries):
- The question asks for data from DIFFERENT tables that require DIFFERENT SQL structures
  (e.g., aggregation + detail, or JSONB unnesting + simple columns)
- Combining everything in one query would require conflicting GROUP BY or produce a cartesian product
- One part needs CROSS JOIN LATERAL (JSONB array unnesting) while another just needs simple columns

## When NOT to decompose (return decompose: false):
- The question targets one table or closely related tables that JOIN cleanly
- A single query with JOINs can answer everything without conflicting aggregations
- The question is simple enough for one SQL statement

## Available Schema
${schemaLines.join("\n")}

## Relationships (JOIN paths)
${relLines.join("\n")}

## JSONB Patterns (require special SQL)
${jsonbLines.join("\n")}

## Planner Context
- Domain: ${plan.domain}
- Tables identified: ${plan.tables_needed.join(", ")}
- Intent: ${plan.intent}

## Response Format
Return a JSON object:

If single query is sufficient:
{"decompose": false}

If decomposition needed:
{
  "decompose": true,
  "sub_queries": [
    {
      "id": "sq_1",
      "intent": "What this sub-query finds (natural language)",
      "tables_needed": ["table_name"],
      "join_key": "column_that_links_to_other_subqueries"
    },
    {
      "id": "sq_2",
      "intent": "What this sub-query finds",
      "tables_needed": ["table_name"],
      "depends_on": ["sq_1"],
      "join_key": "column_that_links_to_anchor"
    }
  ],
  "stitch_key": "entity_id_column",
  "stitch_strategy": "merge_columns | nested | append_rows"
}

stitch_strategy rules:
- "merge_columns": sub-queries return different columns for the same entities (LEFT JOIN by stitch_key)
- "nested": one sub-query returns multiple child rows per entity (e.g., products per customer) — nest as arrays
- "append_rows": completely different entity types concatenated (rare)

The FIRST sub-query is the "anchor" — it runs first and provides entity IDs for dependent sub-queries.
Max ${MAX_SUB_QUERIES} sub-queries. Each MUST have a join_key.

Respond with ONLY the JSON object. No explanation.`;
}

/**
 * Format a table for the decomposer prompt.
 * Shows name, columns with types, and highlights JSONB array columns.
 */
function formatTableForPrompt(table: TableSchema): string {
  const cols = table.columns
    .map((c) => {
      let desc = `${c.name} (${c.type}`;
      if (c.jsonb_keys && c.jsonb_keys.length > 0) {
        desc += `, keys: ${c.jsonb_keys.join(", ")}`;
      }
      desc += ")";
      if (isArrayColumn(c.name)) {
        desc += " [JSONB ARRAY — needs unnesting]";
      }
      return desc;
    })
    .join(", ");

  const rels = table.relationships
    .map((r) => `${r.source_column}→${r.target_table}.${r.target_column}`)
    .join(", ");

  let line = `  ${table.name} [${table.domain}]: ${cols}`;
  if (rels) line += ` | FKs: ${rels}`;
  return line;
}

/* ── Validation & Building ────────────────────────────── */

/**
 * Validate LLM output and build a clean DecomposedPlan.
 * Enforces max sub-queries, join_key requirement, etc.
 */
function validateAndBuild(
  parsed: Record<string, unknown>,
  plan: QueryPlan
): DecomposedPlan | null {
  const rawSubQueries = parsed.sub_queries as Array<Record<string, unknown>>;
  if (!Array.isArray(rawSubQueries) || rawSubQueries.length < 2) {
    return null;
  }

  // Cap at MAX_SUB_QUERIES
  const capped = rawSubQueries.slice(0, MAX_SUB_QUERIES);

  const subQueries: SubQuery[] = capped.map((raw, index) => {
    const id = typeof raw.id === "string" ? raw.id : `sq_${index + 1}`;
    const isAnchor = index === 0;

    // Determine domain from tables_needed
    const tablesNeeded = Array.isArray(raw.tables_needed)
      ? (raw.tables_needed as string[])
      : plan.tables_needed;

    const domain = typeof raw.domain === "string"
      ? raw.domain
      : plan.domain;

    // Ensure join_key exists
    const joinKey = typeof raw.join_key === "string"
      ? raw.join_key
      : "id";

    // Dependencies
    const dependsOn = isAnchor
      ? undefined
      : Array.isArray(raw.depends_on)
        ? (raw.depends_on as string[])
        : ["sq_1"];

    return {
      id,
      intent: typeof raw.intent === "string" ? raw.intent : `Sub-query ${index + 1}`,
      domain,
      tables_needed: tablesNeeded,
      depends_on: dependsOn,
      join_key: joinKey,
      resolved_references: isAnchor
        ? { ...plan.resolved_references }
        : {},
    };
  });

  // Determine stitch key and strategy
  const stitchKey = typeof parsed.stitch_key === "string"
    ? parsed.stitch_key
    : "id";

  const validStrategies = ["merge_columns", "append_rows", "nested"] as const;
  const stitchStrategy = validStrategies.includes(parsed.stitch_strategy as typeof validStrategies[number])
    ? (parsed.stitch_strategy as "merge_columns" | "append_rows" | "nested")
    : "merge_columns";

  return {
    sub_queries: subQueries,
    stitch_key: stitchKey,
    stitch_strategy: stitchStrategy,
  };
}

/* ── Helpers ──────────────────────────────────────────── */

/**
 * Check if a column name suggests it's a JSONB array (needs unnesting).
 * Derived from column naming conventions, not hardcoded table names.
 */
function isArrayColumn(columnName: string): boolean {
  const arrayHints = ["line_items", "items", "tags", "affinities", "elements", "entries"];
  return arrayHints.some((h) => columnName.includes(h));
}

/**
 * Tables that are infrastructure and shouldn't appear in decomposition.
 */
function isInfrastructureTable(tableName: string): boolean {
  const infra = new Set([
    "graph_nodes", "graph_edges", "events", "document_chunks",
    "memories", "llm_logs", "query_history", "schema_migrations",
  ]);
  return infra.has(tableName);
}
