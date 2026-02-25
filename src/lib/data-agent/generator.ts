/**
 * Generator — produces SQL from a QueryPlan + RetrievalContext
 *
 * Two modes:
 * - Mode A: New SQL generation (fresh question)
 * - Mode B: CoE-SQL editing (follow-ups/refinements — edit previous SQL)
 *
 * Uses Sonnet for complex multi-table queries, Haiku for simple ones.
 * All generated SQL goes through safety validation before returning.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { QueryPlan, RetrievalContext, SemanticLayer, SubQuery } from "./types";
import { findFallbackPath } from "./semantic-layer";

/* ── Constants ───────────────────────────────────────── */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-20250514";

/* ── Main Generator ──────────────────────────────────── */

/**
 * Generate SQL for the given plan and context.
 * Routes to new generation or CoE-SQL editing based on turn type.
 */
export async function generateSQL(
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string,
  semanticLayer?: SemanticLayer
): Promise<string> {
  let sql: string;

  if (
    (plan.turn_type === "refinement" || plan.turn_type === "follow_up") &&
    plan.previous_sql &&
    plan.edit_instruction
  ) {
    // Mode B: Edit existing SQL
    sql = await generateCoeSql(plan, context, orgId);
  } else {
    // Mode A: Generate fresh SQL
    sql = await generateNewSql(plan, context, orgId, semanticLayer);
  }

  // Safety validation
  validateSql(sql);

  // Ensure org_id filter
  sql = ensureOrgIdFilter(sql, orgId);

  // Ensure LIMIT
  sql = ensureLimit(sql);

  return sql;
}

/* ── Mode A: New SQL Generation ──────────────────────── */

async function generateNewSql(
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string,
  semanticLayer?: SemanticLayer
): Promise<string> {
  const prompt = buildNewSqlPrompt(plan, context, orgId, semanticLayer);

  // Use Sonnet for complex multi-table queries, Haiku for simple
  const isComplex =
    plan.tables_needed.length > 2 ||
    plan.intent.toLowerCase().includes("join") ||
    plan.intent.toLowerCase().includes("across") ||
    Object.keys(plan.resolved_references).length > 0;

  const model = isComplex ? SONNET_MODEL : HAIKU_MODEL;

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: prompt,
    messages: [
      {
        role: "user",
        content: plan.intent,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return extractSql(text);
}

/* ── Mode B: CoE-SQL Editing ─────────────────────────── */

async function generateCoeSql(
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string
): Promise<string> {
  const prompt = buildCoeSqlPrompt(plan, context, orgId);

  // CoE-SQL edits are simpler — always use Haiku
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: prompt,
    messages: [
      {
        role: "user",
        content: `Edit instruction: ${plan.edit_instruction}\n\nPrevious SQL:\n${plan.previous_sql}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return extractSql(text);
}

/* ── Prompt Builders ─────────────────────────────────── */

function buildNewSqlPrompt(
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string,
  semanticLayer?: SemanticLayer
): string {
  const parts: string[] = [];

  parts.push(`You are a PostgreSQL query generator for a multi-tenant SaaS platform. Generate a single SELECT query.

## CRITICAL RULES
- Every query MUST include \`org_id = '${orgId}'\` in the WHERE clause of the primary table
- Only SELECT queries — no INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE
- Include LIMIT (default 100, use smaller for "top N" questions)
- Use table aliases (c for customers, o for orders, etc.)
- For JSONB access, use ->> for text and -> for objects
- For JSONB arrays, use jsonb_array_elements() to unnest in a LATERAL join or CROSS JOIN
- Cast numeric comparisons explicitly: (field->>'price')::numeric
- Always qualify column names with table aliases when joining
- When aggregating over JSONB arrays (e.g. line_items), use CROSS JOIN LATERAL jsonb_array_elements(column) AS item
- For "top N" questions, ALWAYS use LIMIT N to match the exact count requested

## JSONB EXAMPLES (use these patterns exactly)
-- Top customers by total spend (uses total_spent column on ecom_customers):
SELECT c.id, c.first_name, c.last_name, c.email, c.total_spent, c.orders_count
FROM ecom_customers c
WHERE c.org_id = '${orgId}'
ORDER BY c.total_spent DESC
LIMIT 5

-- What products do multiple customers buy (unnest line_items, group by customer AND product):
SELECT c.first_name || ' ' || c.last_name AS customer_name, item->>'title' AS product, COUNT(*) AS times_ordered, SUM((item->>'price')::numeric) AS total_spent
FROM ecom_orders o
JOIN ecom_customers c ON c.id = o.customer_id AND c.org_id = o.org_id
CROSS JOIN LATERAL jsonb_array_elements(o.line_items) AS item
WHERE o.org_id = '${orgId}' AND o.customer_id IN ('id1','id2','id3')
GROUP BY c.first_name, c.last_name, item->>'title'
ORDER BY customer_name, total_spent DESC
LIMIT 100

-- Top products across all customers (no customer filter):
SELECT item->>'title' AS product, COUNT(*) AS times_ordered, SUM((item->>'price')::numeric) AS total_revenue
FROM ecom_orders o
CROSS JOIN LATERAL jsonb_array_elements(o.line_items) AS item
WHERE o.org_id = '${orgId}'
GROUP BY item->>'title'
ORDER BY times_ordered DESC
LIMIT 20

-- Customer addresses (JSONB field):
SELECT c.first_name, c.last_name, c.default_address->>'city' AS city, c.default_address->>'province' AS state, c.default_address->>'zip' AS zip
FROM ecom_customers c
WHERE c.org_id = '${orgId}'

IMPORTANT: When asked what multiple customers are purchasing/buying, write ONE query that covers all customers. Never split into per-customer queries.`);

  // Address fallback: if question references address/location data, inject COALESCE pattern
  if (semanticLayer) {
    const addressTerms = /\b(?:address|location|city|zip|state|province|country|where)\b/i;
    if (addressTerms.test(plan.intent)) {
      const fallback = findFallbackPath("ecom_customers", "default_address", semanticLayer);
      if (fallback) {
        parts.push(`\n## Address Fallback Pattern
When querying customer addresses, some customers have no default_address.
Use this COALESCE pattern to fall back to their most recent order's shipping_address:

${fallback.fallback_join}

Then use: ${fallback.coalesce_pattern}

Example:
SELECT c.first_name, c.last_name,
  ${fallback.coalesce_pattern.replace(/KEY/g, "city")} AS city,
  ${fallback.coalesce_pattern.replace(/KEY/g, "zip")} AS zip,
  ${fallback.coalesce_pattern.replace(/KEY/g, "province")} AS state
FROM ecom_customers c
${fallback.fallback_join}
WHERE c.org_id = '${orgId}'`);
      }
    }
  }

  // Schema context
  if (context.schema_context) {
    parts.push(`\n## Database Schema\n${context.schema_context}`);
  }

  // Semantic matches
  if (context.semantic_matches.length > 0) {
    parts.push(
      `\n## Business Term Mappings\n${context.semantic_matches
        .map(
          (m) =>
            `- "${m.term}": ${m.description}\n  SQL: ${m.sql_condition}${m.table ? ` (table: ${m.table})` : ""}`
        )
        .join("\n")}`
    );
  }

  // JOIN paths
  if (context.join_paths.length > 0) {
    parts.push(
      `\n## JOIN Paths\n${context.join_paths.map((j) => `- ${j}`).join("\n")}`
    );
  }

  // Similar past queries (few-shot examples)
  if (context.similar_queries.length > 0) {
    parts.push(
      `\n## Similar Past Queries (for reference)\n${context.similar_queries
        .map((q) => `Q: ${q.question}\nSQL: ${q.sql}`)
        .join("\n\n")}`
    );
  }

  // Resolved references
  if (Object.keys(plan.resolved_references).length > 0) {
    parts.push(
      `\n## Resolved References\n${Object.entries(plan.resolved_references)
        .map(([ref, values]) => {
          const valArray = Array.isArray(values) ? values : [values];
          return `- "${ref}" resolves to: ${valArray
            .slice(0, 10)
            .map((v) => `'${v}'`)
            .join(", ")}${valArray.length > 10 ? ` (${valArray.length} total)` : ""}`;
        })
        .join("\n")}\nUse these values in WHERE/IN clauses as needed.`
    );
  }

  // Session context
  if (context.session_context) {
    parts.push(`\n## Conversation Context\n${context.session_context}`);
  }

  parts.push(
    `\nRespond with ONLY the SQL query. No markdown code blocks, no explanation, no comments. Just the raw SQL.`
  );

  return parts.join("\n");
}

function buildCoeSqlPrompt(
  plan: QueryPlan,
  context: RetrievalContext,
  orgId: string
): string {
  const parts: string[] = [];

  parts.push(`You are a SQL editor. You will receive a previous SQL query and an edit instruction. Modify the SQL to fulfill the instruction.

## CRITICAL RULES
- Keep the org_id = '${orgId}' filter intact
- Only modify what the instruction asks for — don't rewrite the entire query
- Keep all existing JOINs, WHERE conditions, and GROUP BY unless the instruction says to remove them
- If adding a new column from a JSONB field, use ->> for text extraction
- If adding a new JOIN, qualify all column names`);

  // Add schema context for new columns/tables referenced in the edit
  if (context.schema_context) {
    parts.push(`\n## Schema Reference\n${context.schema_context}`);
  }

  // Semantic matches for new terms in the edit instruction
  if (context.semantic_matches.length > 0) {
    parts.push(
      `\n## Term Mappings\n${context.semantic_matches
        .map((m) => `- "${m.term}": ${m.sql_condition}`)
        .join("\n")}`
    );
  }

  // JOIN paths for new tables
  if (context.join_paths.length > 0) {
    parts.push(
      `\n## Available JOINs\n${context.join_paths.map((j) => `- ${j}`).join("\n")}`
    );
  }

  // Resolved references for follow-ups
  if (Object.keys(plan.resolved_references).length > 0) {
    parts.push(
      `\n## Resolved References\n${Object.entries(plan.resolved_references)
        .map(([ref, values]) => {
          const valArray = Array.isArray(values) ? values : [values];
          return `- "${ref}" = ${valArray.slice(0, 10).map((v) => `'${v}'`).join(", ")}`;
        })
        .join("\n")}`
    );
  }

  parts.push(
    `\nRespond with ONLY the modified SQL query. No markdown code blocks, no explanation. Just the raw SQL.`
  );

  return parts.join("\n");
}

/* ── SQL Extraction & Validation ─────────────────────── */

/**
 * Extract raw SQL from LLM response.
 * Handles markdown code blocks, leading/trailing whitespace, etc.
 */
function extractSql(text: string): string {
  let sql = text.trim();

  // Remove markdown code blocks
  const codeBlockMatch = sql.match(/```(?:sql)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    sql = codeBlockMatch[1].trim();
  }

  // Remove trailing semicolons
  sql = sql.replace(/;\s*$/, "").trim();

  return sql;
}

/**
 * Validate SQL for safety. Throws if validation fails.
 */
function validateSql(sql: string): void {
  const lower = sql.toLowerCase().trim();

  // Must start with SELECT or WITH
  if (!lower.startsWith("select") && !lower.startsWith("with")) {
    throw new Error(
      `Generated SQL must start with SELECT or WITH. Got: ${sql.slice(0, 50)}`
    );
  }

  // No destructive keywords
  const forbidden =
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|copy)\b/i;
  if (forbidden.test(sql)) {
    throw new Error(`Generated SQL contains forbidden keywords`);
  }

  // No multiple statements (semicolons in the body)
  const withoutTrailingSemicolon = sql.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error(`Generated SQL contains multiple statements`);
  }
}

/**
 * Ensure the SQL has an org_id filter with the ACTUAL UUID value.
 *
 * Defense in depth: the Generator prompt instructs the LLM to include
 * org_id = '<uuid>', but prompts are probabilistic. This function is
 * the deterministic safety net.
 *
 * Two checks:
 * 1. Does the SQL contain the literal orgId UUID? (strongest check)
 * 2. If not, does it at least mention "org_id"? (fallback: inject the value)
 * 3. If neither, inject a full WHERE clause.
 */
function ensureOrgIdFilter(sql: string, orgId: string): string {
  // Best case: SQL already contains the literal UUID
  if (sql.includes(orgId)) return sql;

  // SQL mentions org_id but not the actual UUID value — replace/inject
  // This catches cases where the LLM wrote org_id = 'some-other-value'
  // or org_id = $1 (parameterized) — both are wrong
  if (sql.toLowerCase().includes("org_id")) {
    // Replace the existing org_id condition with the correct value
    // Match patterns like: org_id = 'anything' or org_id='anything'
    const orgIdPattern = /org_id\s*=\s*'[^']*'/gi;
    if (orgIdPattern.test(sql)) {
      return sql.replace(orgIdPattern, `org_id = '${orgId}'`);
    }
    // org_id is mentioned but not in a = 'value' pattern — append filter
  }

  // No org_id at all — inject into WHERE clause
  const whereMatch = sql.match(/\bWHERE\b/i);
  if (whereMatch) {
    const whereIdx = sql.indexOf(whereMatch[0]);
    const afterWhere = whereIdx + whereMatch[0].length;
    return (
      sql.slice(0, afterWhere) +
      ` org_id = '${orgId}' AND` +
      sql.slice(afterWhere)
    );
  }

  // No WHERE clause — find the right place to insert
  const insertBefore = sql.match(
    /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i
  );
  if (insertBefore) {
    const idx = sql.indexOf(insertBefore[0]);
    return (
      sql.slice(0, idx) +
      `WHERE org_id = '${orgId}' ` +
      sql.slice(idx)
    );
  }

  // Append at end
  return sql + ` WHERE org_id = '${orgId}'`;
}

/**
 * Ensure the SQL has a LIMIT clause.
 */
function ensureLimit(sql: string): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  return sql + " LIMIT 100";
}

/* ── Sub-Query SQL Generation ─────────────────────────── */

/**
 * Generate SQL for a single sub-query within a decomposed plan.
 * Builds a QueryPlan from the SubQuery, injects entity IDs from
 * dependency results, and calls the existing generateNewSql.
 */
export async function generateSubQuerySQL(
  subQuery: SubQuery,
  context: RetrievalContext,
  orgId: string,
  dependencyResults: Map<string, string[]>, // dep_id → entity IDs
  semanticLayer?: SemanticLayer
): Promise<string> {
  // Build a QueryPlan from the SubQuery
  const plan: QueryPlan = {
    turn_type: "new",
    intent: subQuery.intent,
    domain: subQuery.domain,
    ambiguous: false,
    tables_needed: subQuery.tables_needed,
    resolved_references: { ...subQuery.resolved_references },
  };

  // Inject entity IDs from dependencies
  if (subQuery.depends_on && subQuery.depends_on.length > 0) {
    for (const depId of subQuery.depends_on) {
      const entityIds = dependencyResults.get(depId);
      if (entityIds && entityIds.length > 0) {
        plan.resolved_references["_entity_ids"] = entityIds;
      }
    }
  }

  return generateSQL(plan, context, orgId, semanticLayer);
}
