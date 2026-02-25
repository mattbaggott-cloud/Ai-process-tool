/**
 * Presenter — deterministic output layer for the Data Agent
 *
 * Sits after the Corrector in the pipeline:
 * Planner → Retriever → Generator → Corrector → **Presenter**
 *
 * Three responsibilities, all in code, zero LLM calls:
 *
 * 1. ROW COUNT VALIDATION
 *    Planner extracts expected_count from "top 5", etc.
 *    Presenter checks the result. If wrong, flags for retry.
 *
 * 2. PRESENTATION CLASSIFICATION
 *    Decision tree on question keywords + data shape.
 *    Picks chart type, table format, or detail view.
 *
 * 3. STRUCTURED OUTPUT
 *    Builds VisualizationSpec for route.ts to auto-render.
 *    The LLM never decides whether to chart — code does.
 *
 * DESIGN: This is one file. If you need a different presentation
 * engine later, replace this file. The DRGC pipeline doesn't care.
 */

import type {
  QueryPlan,
  QueryResult,
  VisualizationSpec,
  ChartType,
  PresentationHint,
  SchemaMap,
  OutputTemplate,
  ProfileSection,
  MetricCard,
  FieldConfidence,
  DataConfidence,
} from "./types";

/* ── Color Palette ────────────────────────────────────── */

const CHART_COLORS = [
  "#4F46E5", // indigo
  "#0EA5E9", // sky
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
];

/* ── Main Presenter Function ──────────────────────────── */

/**
 * Process query results and attach visualization spec.
 * Mutates the result by adding `visualization` if appropriate.
 *
 * Returns { needsRetry: true, reason: string } if row count is wrong.
 */
export function presentResults(
  result: QueryResult,
  plan: QueryPlan,
  schemaMap: SchemaMap
): { needsRetry: boolean; reason?: string } {
  // Don't present errors or empty results
  if (!result.success || result.data.length === 0) {
    return { needsRetry: false };
  }

  // 1. Row count validation
  const countCheck = validateRowCount(result, plan);
  if (countCheck.needsRetry) {
    return countCheck;
  }

  // 2. Classify presentation type
  const presentationType = classifyPresentation(
    plan,
    result.data,
    plan.presentation_hint || "auto"
  );

  // 3. Build visualization spec
  if (presentationType !== "text_only") {
    const viz = buildVisualization(presentationType, result, plan);
    if (viz) {
      result.visualization = viz;
    }
  }

  // 4. Build factual narrative summary from actual data
  // This is what Claude sees — it wraps these facts in conversation,
  // never extracts facts from a table (which causes hallucination)
  result.narrative_summary = buildNarrativeSummary(result.data, plan);

  // 5. Annotate confidence in narrative if field_confidence is present
  if (result.field_confidence && result.field_confidence.length > 0) {
    result.narrative_summary = annotateConfidence(
      result.narrative_summary,
      result.field_confidence
    );
  }

  // 6. Select output template and build specialized viz if applicable
  const template = selectTemplate(plan, result.data, Object.keys(result.data[0] || {}));
  if (template !== "auto") {
    const templateViz = buildTemplateOutput(template, result, plan);
    if (templateViz) {
      result.visualization = templateViz;
    }
  }

  return { needsRetry: false };
}

/* ── Row Count Validation ─────────────────────────────── */

function validateRowCount(
  result: QueryResult,
  plan: QueryPlan
): { needsRetry: boolean; reason?: string } {
  if (!plan.expected_count) return { needsRetry: false };

  const expected = plan.expected_count;
  const actual = result.row_count;

  // If we got fewer than expected AND the query has a LIMIT that's lower
  // than expected, the SQL generator used the wrong LIMIT
  if (actual < expected) {
    // Check if the SQL has a LIMIT lower than expected
    const limitMatch = result.sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      const sqlLimit = parseInt(limitMatch[1], 10);
      if (sqlLimit < expected) {
        return {
          needsRetry: true,
          reason: `User asked for ${expected} results but SQL has LIMIT ${sqlLimit}. Change LIMIT to ${expected}.`,
        };
      }
    }
    // If the limit is correct but we got fewer rows, the data just doesn't
    // have that many — not an error
  }

  return { needsRetry: false };
}

/* ── Presentation Classification ──────────────────────── */

type PresentationType = "bar_chart" | "line_chart" | "pie_chart" | "table" | "detail" | "text_only";

function classifyPresentation(
  plan: QueryPlan,
  data: Record<string, unknown>[],
  hint: PresentationHint
): PresentationType {
  const columns = Object.keys(data[0] || {});

  // Single row = detail view (key-value pairs, no chart needed)
  if (data.length === 1) {
    return "detail";
  }

  // Explicit hint from user
  if (hint === "detail") return "detail";
  if (hint === "table") return "table";

  // Chart hint — pick the right chart type
  if (hint === "chart") {
    return pickChartType(data, columns);
  }

  // Auto mode — use data shape to decide
  if (hint === "auto") {
    return autoClassify(data, columns, plan);
  }

  return "text_only";
}

/**
 * Auto-classify based on data shape.
 * Rules:
 * - 2-10 rows with a label + numeric column → bar chart
 * - Time-series data (date column + numeric) → line chart
 * - Proportion data (< 6 rows, numeric sums to ~100 or question mentions %) → pie
 * - 10+ rows → table
 * - Default → table
 */
function autoClassify(
  data: Record<string, unknown>[],
  columns: string[],
  plan: QueryPlan
): PresentationType {
  const numericCols = findNumericColumns(data, columns);
  const dateCols = findDateColumns(columns);
  const labelCols = findLabelColumns(columns);

  // No numeric columns → table (nothing to chart)
  if (numericCols.length === 0) return "table";

  // Time-series: has a date column + numeric → line chart
  if (dateCols.length > 0 && numericCols.length > 0 && data.length >= 3) {
    return "line_chart";
  }

  // Small dataset with labels + numbers → bar chart
  // (this catches "top 5 customers by spend", "compare regions", etc.)
  if (data.length >= 2 && data.length <= 15 && labelCols.length > 0) {
    // Check if the question implies comparison
    const lower = plan.intent.toLowerCase();
    const isComparison =
      lower.includes("top") ||
      lower.includes("best") ||
      lower.includes("worst") ||
      lower.includes("highest") ||
      lower.includes("lowest") ||
      lower.includes("most") ||
      lower.includes("least") ||
      lower.includes("compare") ||
      lower.includes("rank");

    if (isComparison) return "bar_chart";
  }

  // Large dataset → table
  if (data.length > 15) return "table";

  // 2-15 rows with numeric data → bar chart by default
  if (data.length >= 2 && labelCols.length > 0 && numericCols.length > 0) {
    return "bar_chart";
  }

  return "table";
}

function pickChartType(
  data: Record<string, unknown>[],
  columns: string[]
): PresentationType {
  const dateCols = findDateColumns(columns);
  const numericCols = findNumericColumns(data, columns);

  // Time-series → line
  if (dateCols.length > 0 && numericCols.length > 0) {
    return "line_chart";
  }

  // Small dataset (< 6) → pie for proportions
  if (data.length <= 5 && numericCols.length === 1) {
    return "pie_chart";
  }

  // Default chart → bar
  return "bar_chart";
}

/* ── Column Classification ────────────────────────────── */

function findNumericColumns(
  data: Record<string, unknown>[],
  columns: string[]
): string[] {
  return columns.filter((col) => {
    const sample = data[0][col];
    if (typeof sample === "number") return true;
    // Check if string values are numeric
    if (typeof sample === "string" && !isNaN(Number(sample)) && sample.trim() !== "") return true;
    return false;
  });
}

function findDateColumns(columns: string[]): string[] {
  const datePatterns = [
    "date", "created_at", "updated_at", "ordered_at",
    "month", "year", "week", "day", "period", "quarter",
    "_at", "timestamp",
  ];
  return columns.filter((col) => {
    const lower = col.toLowerCase();
    return datePatterns.some((p) => lower.includes(p));
  });
}

function findLabelColumns(columns: string[]): string[] {
  const labelPatterns = [
    "name", "title", "label", "email", "customer",
    "product", "category", "type", "status", "stage",
    "city", "state", "province", "country", "region",
  ];
  return columns.filter((col) => {
    const lower = col.toLowerCase();
    // Exclude ID columns
    if (lower === "id" || lower.endsWith("_id")) return false;
    // Include known label patterns
    if (labelPatterns.some((p) => lower.includes(p))) return true;
    // Include any string column that's not a date or ID
    return false;
  });
}

/* ── Visualization Builder ────────────────────────────── */

function buildVisualization(
  type: PresentationType,
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const data = result.data;
  const columns = Object.keys(data[0] || {});

  switch (type) {
    case "bar_chart":
    case "line_chart":
    case "pie_chart":
      return buildChartSpec(type, data, columns, plan);

    case "table":
      return buildTableSpec(data, columns, plan);

    case "detail":
      // Detail view is handled by formatted_message (key-value pairs)
      // No separate visualization needed
      return null;

    case "text_only":
      return null;

    default:
      return null;
  }
}

function buildChartSpec(
  type: "bar_chart" | "line_chart" | "pie_chart",
  data: Record<string, unknown>[],
  columns: string[],
  plan: QueryPlan
): VisualizationSpec | null {
  const numericCols = findNumericColumns(data, columns);
  const labelCols = findLabelColumns(columns);
  const dateCols = findDateColumns(columns);

  if (numericCols.length === 0) return null;

  // Pick x-axis: prefer label columns, then date columns, then first non-numeric
  let xKey: string;
  if (type === "line_chart" && dateCols.length > 0) {
    xKey = dateCols[0];
  } else if (labelCols.length > 0) {
    xKey = labelCols[0];
  } else {
    // Use the first non-numeric column
    const nonNumeric = columns.filter((c) => !numericCols.includes(c));
    if (nonNumeric.length === 0) return null;
    xKey = nonNumeric[0];
  }

  // Pick y-axis: use numeric columns (up to 3)
  const yKeys = numericCols.slice(0, 3);

  const chartType: ChartType = type === "bar_chart" ? "bar"
    : type === "line_chart" ? "line"
    : "pie";

  // Build a clean title
  const title = buildTitle(plan);

  // Coerce numeric columns to actual numbers — SQL/JSONB results
  // often return numeric values as strings, which breaks Recharts
  const coercedData = data.map((row) => {
    const coerced = { ...row };
    for (const col of yKeys) {
      const val = coerced[col];
      if (typeof val === "string" && val.trim() !== "") {
        const num = Number(val);
        if (!isNaN(num)) coerced[col] = num;
      }
    }
    return coerced;
  });

  return {
    type: "chart",
    chart_type: chartType,
    title,
    chart_data: coercedData,
    x_key: xKey,
    y_keys: yKeys,
    colors: CHART_COLORS.slice(0, yKeys.length),
  };
}

function buildTableSpec(
  data: Record<string, unknown>[],
  columns: string[],
  plan: QueryPlan
): VisualizationSpec {
  // Filter out UUID columns for cleaner display
  const displayCols = columns.filter((col) => {
    const lower = col.toLowerCase();
    if (lower === "id" || lower === "org_id") return false;
    // Check if values look like UUIDs
    const sample = data[0][col];
    if (typeof sample === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(sample)) return false;
    return true;
  });

  const headers = displayCols.map(formatHeader);
  const rows = data.map((row) =>
    displayCols.map((col) => formatCellValue(row[col]))
  );

  return {
    type: "table",
    title: buildTitle(plan),
    table_headers: headers,
    table_rows: rows,
    table_footer: `${data.length} result${data.length !== 1 ? "s" : ""}`,
  };
}

/* ── Formatting Helpers ───────────────────────────────── */

function buildTitle(plan: QueryPlan): string {
  // Extract a clean title from the intent
  let title = plan.intent;

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Truncate if too long
  if (title.length > 60) {
    title = title.slice(0, 57) + "...";
  }

  return title;
}

function formatHeader(column: string): string {
  return column
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bUrl\b/g, "URL");
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // Format currency-like numbers
    if (Math.abs(value) >= 1 && value % 1 !== 0) {
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return value.toLocaleString("en-US");
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) return `[${value.length} items]`;
    return JSON.stringify(value).slice(0, 50);
  }
  // Truncate long strings
  const str = String(value);
  if (str.length > 50) return str.slice(0, 47) + "...";
  return str;
}

/* ── Narrative Summary Builder ───────────────────────── */

/**
 * Build a factual, pre-written summary from actual query result data.
 *
 * This is the key anti-hallucination mechanism: Claude receives this
 * summary and wraps it in conversational text — it never needs to
 * "read" a table and extract names/numbers (which causes hallucination).
 *
 * Code produces facts. Claude wraps them in conversation.
 */
function buildNarrativeSummary(
  data: Record<string, unknown>[],
  plan: QueryPlan
): string {
  if (data.length === 0) return "No results found.";

  const columns = Object.keys(data[0]);
  const labelCols = findLabelColumns(columns);
  const numericCols = findNumericColumns(data, columns);

  // Identify the primary label column (name, title, etc.)
  const labelCol = labelCols[0] || columns.find(c => {
    const lower = c.toLowerCase();
    return !lower.endsWith("_id") && lower !== "id" && lower !== "org_id";
  }) || columns[0];

  // Identify the primary value column (the "by" metric)
  const valueCol = numericCols[0];

  // Single row → key-value detail summary
  if (data.length === 1) {
    return buildDetailNarrative(data[0], columns);
  }

  // Ranked list (top N, comparison, etc.)
  const lines: string[] = [];
  const title = plan.intent.charAt(0).toUpperCase() + plan.intent.slice(1);
  lines.push(`**${title}** (${data.length} results):\n`);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const label = formatNarrativeValue(labelCol, row[labelCol]);

    if (valueCol) {
      const value = formatNarrativeValue(valueCol, row[valueCol]);
      // Include additional value columns if present (up to 2 more)
      const extras = numericCols.slice(1, 3)
        .map(col => `${formatNarrativeHeader(col)}: ${formatNarrativeValue(col, row[col])}`)
        .join(", ");
      const extraStr = extras ? ` (${extras})` : "";
      lines.push(`${i + 1}. **${label}** — ${formatNarrativeHeader(valueCol)}: ${value}${extraStr}`);
    } else {
      // No numeric column — just list labels with all available info
      const details = columns
        .filter(c => c !== labelCol)
        .slice(0, 3)
        .map(c => `${formatNarrativeHeader(c)}: ${formatNarrativeValue(c, row[c])}`)
        .join(", ");
      lines.push(`${i + 1}. **${label}**${details ? ` — ${details}` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build a detail narrative for a single row (key-value pairs).
 */
function buildDetailNarrative(
  row: Record<string, unknown>,
  columns: string[]
): string {
  const lines: string[] = [];
  for (const col of columns) {
    const val = row[col];
    if (val === null || val === undefined) continue;
    // Skip UUIDs and org_id
    const lower = col.toLowerCase();
    if (lower === "id" || lower === "org_id" || lower.endsWith("_id")) continue;
    if (typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(val)) continue;

    lines.push(`- **${formatNarrativeHeader(col)}**: ${formatNarrativeValue(col, val)}`);
  }
  return lines.join("\n");
}

/**
 * Format a column name for narrative display.
 */
function formatNarrativeHeader(col: string): string {
  return col
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bId\b/g, "ID");
}

/**
 * Format a value for narrative display with type-aware formatting.
 */
function formatNarrativeValue(col: string, value: unknown): string {
  if (value === null || value === undefined) return "N/A";

  const lower = col.toLowerCase();

  // Detect currency columns by name.
  // "total" alone is NOT currency — "total_customers" is a count.
  // "total" IS currency when combined with money words (total_spent, total_revenue, etc.)
  const moneyWords = ["price", "spent", "revenue", "amount", "cost", "subtotal", "avg_order"];
  const countWords = ["count", "customers", "orders", "products", "people", "records", "items", "num_", "number"];
  const isExplicitMoney = moneyWords.some((w) => lower.includes(w));
  const isExplicitCount = countWords.some((w) => lower.includes(w));
  const isTotalMoney = lower.includes("total") && !isExplicitCount &&
    (lower === "total" || moneyWords.some((w) => lower.includes(w)) || lower.includes("value"));
  const isCurrencyCol = (isExplicitMoney || isTotalMoney) && !isExplicitCount;

  // Numeric values
  if (typeof value === "number" || (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "")) {
    const num = Number(value);
    if (isCurrencyCol) {
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return num.toLocaleString("en-US");
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "object") {
    if (Array.isArray(value)) return `${value.length} items`;
    return JSON.stringify(value).slice(0, 80);
  }

  const str = String(value);
  if (str.length > 80) return str.slice(0, 77) + "...";
  return str;
}

/* ── Output Template Selection ──────────────────────── */

/**
 * Select the best output template based on data shape and query context.
 *
 * Code-only decision tree — no LLM. Examines:
 * - Row count (single vs multiple)
 * - Column names (customer context, metrics, etc.)
 * - Plan intent keywords ("top", "compare", etc.)
 * - Plan's explicit output_template hint
 */
function selectTemplate(
  plan: QueryPlan,
  data: Record<string, unknown>[],
  columns: string[]
): OutputTemplate {
  // If plan has an explicit template hint, use it
  if (plan.output_template && plan.output_template !== "auto") {
    return plan.output_template;
  }

  const lower = plan.intent.toLowerCase();
  const numericCols = findNumericColumns(data, columns);

  // Aggregate question with very few rows (≤3) and numeric data → metric_summary
  // Check this BEFORE single-row checks, because "how many total orders"
  // returns 1 row but should be a metric card, not a detail/profile card
  const isAggregateIntent =
    lower.includes("total") ||
    lower.includes("average") ||
    lower.includes("count") ||
    lower.includes("sum") ||
    lower.includes("how many") ||
    lower.includes("how much");

  if (data.length <= 3 && numericCols.length > 0 && isAggregateIntent) {
    return "metric_summary";
  }

  // Single row + customer context → customer_profile
  if (data.length === 1) {
    const hasCustomerContext = columns.some((c) => {
      const cl = c.toLowerCase();
      return (
        cl.includes("first_name") ||
        cl.includes("last_name") ||
        cl.includes("email") ||
        cl.includes("customer")
      );
    });
    if (hasCustomerContext) return "customer_profile";
    return "detail_card";
  }

  // "top N" with ordered numeric data → ranked_list
  if (
    data.length >= 2 &&
    data.length <= 20 &&
    numericCols.length > 0 &&
    (lower.includes("top") ||
      lower.includes("best") ||
      lower.includes("worst") ||
      lower.includes("highest") ||
      lower.includes("lowest") ||
      lower.includes("most") ||
      lower.includes("least") ||
      lower.includes("rank"))
  ) {
    return "ranked_list";
  }

  // "compare" or 2-5 entities + multiple metrics → comparison_table
  if (
    data.length >= 2 &&
    data.length <= 5 &&
    numericCols.length >= 2 &&
    (lower.includes("compare") ||
      lower.includes("versus") ||
      lower.includes("vs") ||
      lower.includes("difference") ||
      lower.includes("side by side"))
  ) {
    return "comparison_table";
  }

  // Default — let the existing chart/table logic handle it
  return "auto";
}

/* ── Template Output Builders ───────────────────────── */

/**
 * Build a specialized VisualizationSpec for a given template.
 * Returns null if the template can't be built from the available data.
 */
function buildTemplateOutput(
  template: OutputTemplate,
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  switch (template) {
    case "customer_profile":
      return buildCustomerProfileOutput(result, plan);
    case "ranked_list":
      return buildRankedListOutput(result, plan);
    case "comparison_table":
      return buildComparisonTableOutput(result, plan);
    case "metric_summary":
      return buildMetricSummaryOutput(result, plan);
    case "detail_card":
      return buildDetailCardOutput(result, plan);
    default:
      return null;
  }
}

/**
 * Customer profile card — sections: Overview, Purchase History, Behavioral Profile.
 * Confidence badges on each field (green=verified, amber=inferred).
 */
function buildCustomerProfileOutput(
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const row = result.data[0];
  if (!row) return null;

  const columns = Object.keys(row);
  const confidenceMap = buildConfidenceMap(result.field_confidence || []);

  // Categorize columns into sections
  const overviewFields: string[] = [];
  const purchaseFields: string[] = [];
  const behavioralFields: string[] = [];
  const otherFields: string[] = [];

  for (const col of columns) {
    const cl = col.toLowerCase();
    // Skip IDs and org_id
    if (cl === "id" || cl === "org_id" || cl.endsWith("_id")) continue;
    if (typeof row[col] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(row[col] as string)) continue;

    if (
      cl.includes("first_name") || cl.includes("last_name") ||
      cl.includes("email") || cl.includes("phone") ||
      cl.includes("city") || cl.includes("state") ||
      cl.includes("province") || cl.includes("zip") ||
      cl.includes("country") || cl.includes("address") ||
      cl.includes("tags") || cl.includes("created_at")
    ) {
      overviewFields.push(col);
    } else if (
      cl.includes("order") || cl.includes("spent") ||
      cl.includes("total") || cl.includes("revenue") ||
      cl.includes("purchase") || cl.includes("avg_order")
    ) {
      purchaseFields.push(col);
    } else if (
      cl.includes("lifecycle") || cl.includes("communication") ||
      cl.includes("engagement") || cl.includes("risk") ||
      cl.includes("affinity") || cl.includes("behavioral") ||
      cl.includes("segment") || cl.includes("score") ||
      cl.includes("preference")
    ) {
      behavioralFields.push(col);
    } else {
      otherFields.push(col);
    }
  }

  const sections: ProfileSection[] = [];

  if (overviewFields.length > 0) {
    sections.push({
      title: "Overview",
      fields: overviewFields.map((f) => ({
        label: formatHeader(f),
        value: formatCellValue(row[f]),
        confidence: confidenceMap.get(f) || "verified",
      })),
    });
  }

  if (purchaseFields.length > 0) {
    sections.push({
      title: "Purchase History",
      fields: purchaseFields.map((f) => ({
        label: formatHeader(f),
        value: formatCellValue(row[f]),
        confidence: confidenceMap.get(f) || "verified",
      })),
    });
  }

  if (behavioralFields.length > 0) {
    sections.push({
      title: "Behavioral Profile",
      fields: behavioralFields.map((f) => ({
        label: formatHeader(f),
        value: formatCellValue(row[f]),
        confidence: confidenceMap.get(f) || "ai_inferred",
      })),
    });
  }

  if (otherFields.length > 0) {
    sections.push({
      title: "Additional Details",
      fields: otherFields.map((f) => ({
        label: formatHeader(f),
        value: formatCellValue(row[f]),
        confidence: confidenceMap.get(f) || "verified",
      })),
    });
  }

  if (sections.length === 0) return null;

  // Build a title from customer name if available
  const firstName = row["first_name"] || row["name"] || "";
  const lastName = row["last_name"] || "";
  const title = firstName
    ? `${firstName}${lastName ? ` ${lastName}` : ""}`
    : buildTitle(plan);

  return {
    type: "profile",
    title: String(title),
    profile_sections: sections,
  };
}

/**
 * Ranked list — numbered items with position, label, and metric value.
 * Renders as a bar chart with rank ordering.
 */
function buildRankedListOutput(
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const data = result.data;
  const columns = Object.keys(data[0] || {});
  const numericCols = findNumericColumns(data, columns);
  const labelCols = findLabelColumns(columns);

  if (numericCols.length === 0 || labelCols.length === 0) return null;

  // Use existing chart builder — ranked list is essentially a bar chart
  // with the data already sorted by the SQL's ORDER BY
  return buildChartSpec("bar_chart", data, columns, plan);
}

/**
 * Comparison table — side-by-side columns for 2-5 entities.
 * Shows multiple metrics per entity for direct comparison.
 */
function buildComparisonTableOutput(
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const data = result.data;
  const columns = Object.keys(data[0] || {});

  // Filter out UUID/ID columns for cleaner comparison
  const displayCols = columns.filter((col) => {
    const lower = col.toLowerCase();
    if (lower === "id" || lower === "org_id") return false;
    const sample = data[0][col];
    if (typeof sample === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(sample)) return false;
    return true;
  });

  return {
    type: "table",
    title: buildTitle(plan),
    table_headers: displayCols.map(formatHeader),
    table_rows: data.map((row) =>
      displayCols.map((col) => formatCellValue(row[col]))
    ),
    table_footer: `Comparing ${data.length} items`,
  };
}

/**
 * Metric summary — big number cards for aggregate results.
 * Each numeric column becomes a metric card.
 */
function buildMetricSummaryOutput(
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const data = result.data;
  const columns = Object.keys(data[0] || {});
  const numericCols = findNumericColumns(data, columns);
  const confidenceMap = buildConfidenceMap(result.field_confidence || []);

  if (numericCols.length === 0) return null;

  // If single row, each numeric column is a card
  // If multiple rows, aggregate across rows
  const cards: MetricCard[] = [];

  if (data.length === 1) {
    const row = data[0];
    for (const col of numericCols) {
      cards.push({
        label: formatHeader(col),
        value: formatNarrativeValue(col, row[col]),
        confidence: confidenceMap.get(col) || "verified",
      });
    }
  } else {
    // Multiple rows — summarize each numeric column
    for (const col of numericCols) {
      const values = data
        .map((row) => Number(row[col]))
        .filter((v) => !isNaN(v));
      if (values.length === 0) continue;

      const total = values.reduce((a, b) => a + b, 0);
      cards.push({
        label: `Total ${formatHeader(col)}`,
        value: formatNarrativeValue(col, total),
        confidence: confidenceMap.get(col) || "computed",
      });
    }
  }

  if (cards.length === 0) return null;

  return {
    type: "metric",
    title: buildTitle(plan),
    metric_cards: cards,
  };
}

/**
 * Detail card — single entity, key-value display.
 * Like customer_profile but without section categorization.
 */
function buildDetailCardOutput(
  result: QueryResult,
  plan: QueryPlan
): VisualizationSpec | null {
  const row = result.data[0];
  if (!row) return null;

  const columns = Object.keys(row);
  const confidenceMap = buildConfidenceMap(result.field_confidence || []);

  const fields = columns
    .filter((col) => {
      const lower = col.toLowerCase();
      if (lower === "id" || lower === "org_id" || lower.endsWith("_id")) return false;
      if (typeof row[col] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(row[col] as string)) return false;
      if (row[col] === null || row[col] === undefined) return false;
      return true;
    })
    .map((col) => ({
      label: formatHeader(col),
      value: formatCellValue(row[col]),
      confidence: (confidenceMap.get(col) || "verified") as DataConfidence,
    }));

  if (fields.length === 0) return null;

  return {
    type: "profile",
    title: buildTitle(plan),
    profile_sections: [
      {
        title: "Details",
        fields,
      },
    ],
  };
}

/* ── Confidence Annotation ──────────────────────────── */

/**
 * Annotate a narrative summary with confidence markers.
 *
 * For fields that are AI-inferred, appends "(AI-inferred)" after their
 * value in the narrative text. This tells Claude (and the user) which
 * data points are factual database records vs AI-generated profiles.
 */
function annotateConfidence(
  narrative: string | undefined,
  fieldConfidence: FieldConfidence[]
): string {
  if (!narrative) return "";

  const inferredFields = fieldConfidence.filter(
    (fc) => fc.confidence === "ai_inferred"
  );

  if (inferredFields.length === 0) return narrative;

  let annotated = narrative;

  // For each inferred field, find its formatted header in the narrative
  // and append the confidence marker
  for (const fc of inferredFields) {
    const header = formatNarrativeHeader(fc.field);
    // Match "**Header**: value" pattern and append marker after the value
    // Use a regex that finds the header and its value on the same line
    const pattern = new RegExp(
      `(\\*\\*${escapeRegex(header)}\\*\\*:\\s*[^\\n]+)`,
      "g"
    );
    annotated = annotated.replace(pattern, "$1 _(AI-inferred)_");
  }

  // If there are inferred fields, add a footer note
  if (inferredFields.length > 0) {
    const fieldNames = inferredFields.map((f) => formatNarrativeHeader(f.field)).join(", ");
    annotated += `\n\n_Note: ${fieldNames} ${inferredFields.length === 1 ? "is" : "are"} AI-generated and may not be 100% accurate._`;
  }

  return annotated;
}

/* ── Confidence Helpers ─────────────────────────────── */

/**
 * Build a map from column name → confidence level for quick lookup.
 */
function buildConfidenceMap(
  fieldConfidence: FieldConfidence[]
): Map<string, DataConfidence> {
  const map = new Map<string, DataConfidence>();
  for (const fc of fieldConfidence) {
    map.set(fc.field, fc.confidence);
  }
  return map;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
