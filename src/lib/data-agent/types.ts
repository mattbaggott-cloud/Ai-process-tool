/**
 * Data Agent — Type Definitions
 *
 * Core types for the DRGCP pipeline:
 * Planner → Retriever → Generator → Corrector → Presenter
 */

/* ── Schema Representation ───────────────────────────── */

export interface ColumnSchema {
  name: string;
  type: string; // postgres data type (text, uuid, jsonb, numeric, etc.)
  nullable: boolean;
  default_value?: string | null;
  jsonb_keys?: string[]; // for JSONB columns — sampled keys from actual data
  description?: string;
}

export interface RelationshipSchema {
  target_table: string;
  source_column: string;
  target_column: string;
  constraint_name?: string;
}

export type DomainType =
  | "ecommerce"
  | "crm"
  | "campaigns"
  | "behavioral"
  | "identity"
  | "internal";

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  relationships: RelationshipSchema[];
  description: string;
  domain: DomainType;
}

export interface SchemaMap {
  tables: Map<string, TableSchema>;
  indexed_at: number; // timestamp ms
}

/* ── Session State ───────────────────────────────────── */

export interface QueryTurn {
  question: string;
  sql: string;
  tables: string[];
  domain: string;
  entity_ids: string[];
  result_values: Record<string, unknown[]>; // extracted values for follow-ups (e.g., zip codes)
  result_summary: string;
  timestamp: number;
}

export interface DataAgentSession {
  session_id: string;
  org_id: string;
  current_domain: string | null;
  active_entity_type: string | null;
  active_entity_ids: string[];
  accumulated_filters: Record<string, unknown>;
  queries: QueryTurn[];
  last_activity: number; // timestamp ms
}

/* ── Multi-Query Decomposition ──────────────────────── */

/** A single sub-query within a decomposed plan */
export interface SubQuery {
  id: string; // "sq_1", "sq_2", etc.
  intent: string; // "Find top 5 customers by total spend"
  domain: string;
  tables_needed: string[];
  depends_on?: string[]; // ["sq_1"] — needs entity IDs from prior sub-query
  join_key?: string; // column to stitch results on (e.g., "id", "customer_id")
  resolved_references: Record<string, unknown>;
}

/** A plan decomposed into multiple sub-queries */
export interface DecomposedPlan {
  sub_queries: SubQuery[];
  stitch_key: string; // entity ID column to join results on
  stitch_strategy: "merge_columns" | "append_rows" | "nested";
}

/* ── Structured Clarification ──────────────────────── */

export interface ClarificationOption {
  label: string; // "Just Shopify customers"
  value: string; // "ecommerce"
  description?: string; // "B2C customers imported from Shopify"
}

export interface StructuredClarification {
  question: string; // "Which customers do you mean?"
  options: ClarificationOption[];
  allow_freeform: boolean; // true = user can type something else
  reason: "multi_part" | "domain_ambiguous" | "term_ambiguous";
}

/* ── Output Templates ──────────────────────────────── */

/** Template types for structured output formatting */
export type OutputTemplate =
  | "customer_profile" // single-entity deep dive with sections
  | "ranked_list" // top-N with position, label, metric
  | "comparison_table" // side-by-side with multiple entities
  | "metric_summary" // aggregate numbers with deltas
  | "detail_card" // single row, key-value pairs
  | "auto"; // presenter decides (default)

/* ── Data Confidence ───────────────────────────────── */

/** How confident we are in a data field's accuracy */
export type DataConfidence = "verified" | "ai_inferred" | "computed";

/** Confidence metadata for a specific field in the result */
export interface FieldConfidence {
  field: string;
  confidence: DataConfidence;
  source_table?: string; // where this field came from
  description?: string; // "AI-generated during profiling run"
}

/* ── Semantic Layer: Fallback + Confidence Config ──── */

/** Fallback path when a primary column is null */
export interface FallbackPath {
  primary_table: string;
  primary_column: string;
  fallback_table: string;
  fallback_column: string;
  fallback_join: string; // LATERAL JOIN SQL to reach fallback
  coalesce_pattern: string; // COALESCE pattern with KEY placeholder
  description: string;
}

/** Per-table confidence configuration */
export interface TableConfidenceConfig {
  table: string;
  confidence: DataConfidence;
  description: string;
  fields?: string[]; // if only specific fields are AI-inferred
}

/* ── Pipeline Types ──────────────────────────────────── */

export type TurnType = "new" | "follow_up" | "pivot" | "refinement";

export interface QueryPlan {
  turn_type: TurnType;
  intent: string;
  domain: string;
  ambiguous: boolean;
  candidate_domains?: string[];
  tables_needed: string[];
  resolved_references: Record<string, unknown>; // "their" → [id1, id2, id3]
  edit_instruction?: string; // for CoE-SQL: "add zip column"
  previous_sql?: string; // the SQL being edited
  needs_clarification?: string; // formatted clarifying question
  expected_count?: number; // extracted from "top 5", "first 10", etc.
  presentation_hint?: PresentationHint; // how the user wants to see results
  /** Phase 3: Multi-query decomposition */
  decomposed?: DecomposedPlan;
  /** Phase 3: Structured clarification with options */
  structured_clarification?: StructuredClarification;
  /** Phase 3: Desired output template */
  output_template?: OutputTemplate;
}

/* ── Presentation Types ────────────────────────────────── */

/** Presentation intent extracted from the question — code-level, no LLM */
export type PresentationHint = "chart" | "table" | "detail" | "auto";

/** Chart types supported by the inline chart renderer */
export type ChartType = "bar" | "line" | "pie" | "area";

/** A section within a customer profile card */
export interface ProfileSection {
  title: string; // "Overview", "Purchase History", "Behavioral Profile"
  fields: Array<{
    label: string;
    value: string;
    confidence: DataConfidence;
  }>;
}

/** A single metric card (big number + optional delta) */
export interface MetricCard {
  label: string;
  value: string;
  change?: string; // "+12% vs last month"
  confidence: DataConfidence;
}

/** Structured visualization spec — consumed by route.ts to auto-render */
export interface VisualizationSpec {
  type: "chart" | "table" | "profile" | "metric";
  chart_type?: ChartType;
  title: string;
  /** For charts: array of data points */
  chart_data?: Record<string, unknown>[];
  x_key?: string;
  y_keys?: string[];
  colors?: string[];
  /** For tables: headers + rows */
  table_headers?: string[];
  table_rows?: string[][];
  table_footer?: string;
  /** For profile cards: structured sections with confidence */
  profile_sections?: ProfileSection[];
  /** For metric summaries: big number cards */
  metric_cards?: MetricCard[];
}

/** Per-stage timing breakdown for observability */
export interface StageTimings {
  schema_ms: number; // schema introspection + indexing
  plan_ms: number; // intent classification + ambiguity detection
  retrieve_ms: number; // context assembly (hybrid search, graph, semantic layer)
  generate_ms: number; // SQL generation (Claude API call)
  correct_ms: number; // execution + validation + self-correction retries
  present_ms: number; // presentation classification + viz building + narrative
  total_ms: number; // end-to-end pipeline time
  /** Phase 3: Multi-query decomposition */
  decompose_ms?: number; // time spent decomposing question
  stitch_ms?: number; // time spent merging sub-query results
}

export interface QueryResult {
  success: boolean;
  sql: string;
  data: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
  formatted_message: string;
  error?: string;
  needs_clarification?: boolean; // true = response is a question, not data
  visualization?: VisualizationSpec; // structured viz for auto-rendering
  narrative_summary?: string; // pre-built factual summary — Claude wraps, never extracts
  stage_timings?: StageTimings; // per-stage latency breakdown for observability
  /** Phase 3: Confidence metadata for each field */
  field_confidence?: FieldConfidence[];
  /** Phase 3: Individual sub-query results (populated for multi-query) */
  sub_results?: QueryResult[];
  /** Phase 3: Entity ID column used to merge sub-results */
  stitch_key?: string;
}

/* ── Retrieval Context (assembled by Retriever) ──────── */

export interface RetrievalContext {
  /** Schema DDL + column info for relevant tables */
  schema_context: string;
  /** Business term → SQL condition matches from semantic layer */
  semantic_matches: SemanticMatch[];
  /** Similar past queries from query_history (few-shot examples) */
  similar_queries: PastQuery[];
  /** Session context for follow-ups */
  session_context: string | null;
  /** JOIN paths discovered via graph traversal */
  join_paths: string[];
}

export interface SemanticMatch {
  term: string;
  sql_condition: string;
  table?: string;
  description?: string;
}

export interface PastQuery {
  question: string;
  sql: string;
  tables: string[];
  similarity: number;
}

/* ── Semantic Layer Types ────────────────────────────── */

export interface SemanticLayer {
  domains: Record<string, DomainConfig>;
  terms: TermMapping[];
  metrics: MetricDefinition[];
  relationships: RelationshipPath[];
  jsonb_patterns: JsonbPattern[];
  /** Phase 3: Fallback paths for null columns (e.g., address fallback) */
  fallbacks: FallbackPath[];
  /** Phase 3: Per-table data confidence (verified vs AI-inferred) */
  confidence_registry: TableConfidenceConfig[];
}

export interface DomainConfig {
  tables: string[];
  description: string;
  primary_table: string;
}

export interface TermMapping {
  terms: string[]; // e.g., ["VIP", "high value", "top customer"]
  sql_condition: string; // e.g., "total_spent > 500"
  table: string;
  description: string;
}

export interface MetricDefinition {
  name: string;
  aliases: string[]; // e.g., ["AOV", "average order value"]
  sql_expression: string;
  table: string;
  description: string;
}

export interface RelationshipPath {
  from_table: string;
  to_table: string;
  join_sql: string; // e.g., "JOIN ecom_orders o ON o.customer_id = c.id"
  description: string;
}

export interface JsonbPattern {
  table: string;
  column: string;
  keys: string[];
  access_pattern: string; // e.g., "default_address->>'zip'"
  description: string;
}
