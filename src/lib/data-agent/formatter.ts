/**
 * Dynamic Result Formatter
 *
 * Formats query results using column type metadata from SchemaMap.
 * Handles currency, dates, JSONB flattening, UUIDs, and generates
 * inline table markers for frontend rendering.
 */

import type { SchemaMap, ColumnSchema } from "./types";

/* ── Main Formatter ──────────────────────────────────── */

/**
 * Format query results into a human-readable string.
 * Uses column type metadata to apply appropriate formatting.
 */
export function formatResults(
  data: Record<string, unknown>[],
  schemaMap: SchemaMap,
  tables: string[]
): string {
  if (!data || data.length === 0) {
    return "No results found.";
  }

  // Get column types from the schema
  const columnTypes = buildColumnTypeMap(schemaMap, tables);

  // Single row — display as key-value pairs
  if (data.length === 1) {
    return formatSingleRow(data[0], columnTypes);
  }

  // Multiple rows — display as a table
  return formatTable(data, columnTypes);
}

/* ── Column Type Map ─────────────────────────────────── */

interface ColumnTypeInfo {
  type: string;
  isCurrency: boolean;
  isDate: boolean;
  isJsonb: boolean;
  isUuid: boolean;
  isBoolean: boolean;
  isNumeric: boolean;
}

function buildColumnTypeMap(
  schemaMap: SchemaMap,
  tables: string[]
): Map<string, ColumnTypeInfo> {
  const typeMap = new Map<string, ColumnTypeInfo>();

  for (const tableName of tables) {
    const table = schemaMap.tables.get(tableName);
    if (!table) continue;

    for (const col of table.columns) {
      const info = classifyColumn(col);
      typeMap.set(col.name, info);

      // Also map aliases (e.g., "total" for aggregate expressions)
      // These get picked up from the actual result keys
    }
  }

  return typeMap;
}

function classifyColumn(col: ColumnSchema): ColumnTypeInfo {
  const type = col.type.toLowerCase();
  const name = col.name.toLowerCase();

  // Currency detection: numeric columns with money-related names.
  // "total" alone is NOT currency — "total_customers" is a count.
  const moneyWords = ["price", "spent", "revenue", "amount", "cost", "subtotal", "avg_order"];
  const countWords = ["count", "customers", "orders", "products", "people", "records", "items", "num_", "number"];
  const isExplicitMoney = moneyWords.some((w) => name.includes(w));
  const isExplicitCount = countWords.some((w) => name.includes(w));
  const isTotalMoney = name.includes("total") && !isExplicitCount &&
    (name === "total" || moneyWords.some((w) => name.includes(w)) || name.includes("value"));
  const isCurrency =
    (type.includes("numeric") || type.includes("double") || type.includes("real") || type.includes("bigint") || type.includes("integer")) &&
    (isExplicitMoney || isTotalMoney) && !isExplicitCount;

  return {
    type,
    isCurrency,
    isDate:
      type.includes("timestamp") ||
      type.includes("date") ||
      type.includes("time"),
    isJsonb: type === "jsonb",
    isUuid: type === "uuid",
    isBoolean: type === "boolean",
    isNumeric:
      type.includes("numeric") ||
      type.includes("integer") ||
      type.includes("bigint") ||
      type.includes("double") ||
      type.includes("real") ||
      type.includes("smallint"),
  };
}

/* ── Single Row Format ───────────────────────────────── */

function formatSingleRow(
  row: Record<string, unknown>,
  columnTypes: Map<string, ColumnTypeInfo>
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;

    const label = formatColumnName(key);
    const formatted = formatValue(key, value, columnTypes);
    lines.push(`**${label}**: ${formatted}`);
  }

  return lines.join("\n");
}

/* ── Table Format ────────────────────────────────────── */

function formatTable(
  data: Record<string, unknown>[],
  columnTypes: Map<string, ColumnTypeInfo>
): string {
  if (data.length === 0) return "No results.";

  // Get column keys from first row
  const keys = Object.keys(data[0]);

  // Build header
  const headers = keys.map(formatColumnName);

  // Build rows
  const rows = data.map((row) =>
    keys.map((key) => formatValue(key, row[key], columnTypes))
  );

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxDataWidth = Math.max(...rows.map((r) => r[i].length));
    return Math.min(Math.max(h.length, maxDataWidth), 40); // Cap at 40 chars
  });

  // Build markdown table
  const parts: string[] = [];

  // Header row
  const headerRow = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join(" | ");
  parts.push(`| ${headerRow} |`);

  // Separator
  const separator = widths.map((w) => "-".repeat(w)).join(" | ");
  parts.push(`| ${separator} |`);

  // Data rows
  for (const row of rows) {
    const dataRow = row
      .map((cell, i) => cell.slice(0, 40).padEnd(widths[i]))
      .join(" | ");
    parts.push(`| ${dataRow} |`);
  }

  // Add inline table marker for frontend rendering
  const tableStr = parts.join("\n");
  if (data.length > 1) {
    return `<!--INLINE_TABLE:${data.length}-->\n${tableStr}`;
  }

  return tableStr;
}

/* ── Value Formatting ────────────────────────────────── */

function formatValue(
  key: string,
  value: unknown,
  columnTypes: Map<string, ColumnTypeInfo>
): string {
  if (value === null || value === undefined) return "-";

  const typeInfo = columnTypes.get(key);

  // Infer formatting from the key name and value when type info is missing
  // (happens for computed columns like SUM, AVG, etc.)
  const inferredInfo = typeInfo || inferType(key, value);

  // Currency
  if (inferredInfo.isCurrency && typeof value === "number") {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // Dates
  if (inferredInfo.isDate && (typeof value === "string" || value instanceof Date)) {
    return formatDate(value);
  }

  // JSONB
  if (inferredInfo.isJsonb || (typeof value === "object" && value !== null)) {
    return formatJsonb(value);
  }

  // UUID — truncate
  if (
    inferredInfo.isUuid ||
    (typeof value === "string" && isUuidLike(value))
  ) {
    return (value as string).slice(0, 8) + "...";
  }

  // Boolean
  if (inferredInfo.isBoolean || typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  // Numbers
  if (inferredInfo.isNumeric && typeof value === "number") {
    // Check if it looks like a currency by name — but exclude count columns
    const lowerKey = key.toLowerCase();
    const moneyKw = ["price", "spent", "revenue", "amount", "cost", "subtotal", "avg_order"];
    const countKw = ["count", "customers", "orders", "products", "people", "records", "items", "num_", "number"];
    const isCount = countKw.some((w) => lowerKey.includes(w));
    const isMoney = moneyKw.some((w) => lowerKey.includes(w));
    const isTotalMoney = lowerKey.includes("total") && !isCount &&
      (lowerKey === "total" || moneyKw.some((w) => lowerKey.includes(w)) || lowerKey.includes("value"));
    if ((isMoney || isTotalMoney) && !isCount) {
      return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return value.toLocaleString("en-US");
  }

  return String(value);
}

/**
 * Infer type info from key name and value when schema type info is missing.
 * This handles computed columns (SUM, AVG, COUNT, etc.)
 */
function inferType(key: string, value: unknown): ColumnTypeInfo {
  const lowerKey = key.toLowerCase();
  const isNumber = typeof value === "number";

  // Smart currency detection — exclude count columns
  const moneyKw = ["price", "spent", "revenue", "amount", "cost", "subtotal", "avg_order"];
  const countKw = ["count", "customers", "orders", "products", "people", "records", "items", "num_", "number"];
  const isExplicitMoney = moneyKw.some((w) => lowerKey.includes(w));
  const isExplicitCount = countKw.some((w) => lowerKey.includes(w));
  const isTotalMoney = lowerKey.includes("total") && !isExplicitCount &&
    (lowerKey === "total" || moneyKw.some((w) => lowerKey.includes(w)) || lowerKey.includes("value"));

  return {
    type: typeof value === "string" ? "text" : typeof value === "number" ? "numeric" : "unknown",
    isCurrency: isNumber && (isExplicitMoney || isTotalMoney) && !isExplicitCount,
    isDate:
      typeof value === "string" &&
      (lowerKey.includes("date") ||
        lowerKey.includes("_at") ||
        lowerKey.includes("created") ||
        lowerKey.includes("updated")),
    isJsonb: typeof value === "object" && value !== null,
    isUuid: typeof value === "string" && isUuidLike(value),
    isBoolean: typeof value === "boolean",
    isNumeric: isNumber,
  };
}

/* ── Formatting Helpers ──────────────────────────────── */

function formatColumnName(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bSql\b/g, "SQL");
}

function formatDate(value: unknown): string {
  try {
    const date = new Date(value as string);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(value);
  }
}

function formatJsonb(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // If array of primitives, join them
    if (typeof value[0] !== "object") {
      return value.join(", ");
    }
    // Array of objects — show count
    return `[${value.length} items]`;
  }

  if (typeof value === "object" && value !== null) {
    // Flatten one level
    const parts: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null && v !== undefined && v !== "") {
        parts.push(`${k}: ${v}`);
      }
    }
    return parts.join(", ") || "{}";
  }

  return String(value);
}

function isUuidLike(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

/* ── Summary Generator ───────────────────────────────── */

/**
 * Generate a compact summary of query results.
 * Used when storing results for later search_tool_results retrieval.
 */
export function generateResultSummary(
  data: Record<string, unknown>[],
  question: string
): string {
  if (data.length === 0) return `No results found for: ${question}`;

  const keys = Object.keys(data[0]);
  const summary = [
    `Query: ${question}`,
    `Results: ${data.length} row(s)`,
    `Columns: ${keys.join(", ")}`,
  ];

  // Add first 3 rows as preview
  const preview = data.slice(0, 3);
  for (let i = 0; i < preview.length; i++) {
    const row = preview[i];
    const values = keys
      .map((k) => {
        const v = row[k];
        if (v === null || v === undefined) return null;
        if (typeof v === "object") return JSON.stringify(v).slice(0, 50);
        return String(v).slice(0, 50);
      })
      .filter(Boolean);
    summary.push(`Row ${i + 1}: ${values.join(" | ")}`);
  }

  if (data.length > 3) {
    summary.push(`... and ${data.length - 3} more rows`);
  }

  return summary.join("\n");
}
