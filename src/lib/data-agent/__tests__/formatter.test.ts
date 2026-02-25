/**
 * Tests for Formatter — dynamic result formatting and summary generation.
 * Tests pure functions with mock SchemaMap data.
 */

import { describe, it, expect } from "vitest";
import { formatResults, generateResultSummary } from "../formatter";
import type { SchemaMap, TableSchema, ColumnSchema } from "../types";

/* ── Helper: build a minimal SchemaMap for tests ──────── */

function makeSchemaMap(tables: Record<string, ColumnSchema[]>): SchemaMap {
  const map: SchemaMap = {
    tables: new Map<string, TableSchema>(),
    indexed_at: Date.now(),
  };

  for (const [tableName, columns] of Object.entries(tables)) {
    map.tables.set(tableName, {
      name: tableName,
      columns,
      relationships: [],
      description: `Test table ${tableName}`,
      domain: "ecommerce",
    });
  }

  return map;
}

const ECOM_CUSTOMER_COLUMNS: ColumnSchema[] = [
  { name: "id", type: "uuid", nullable: false },
  { name: "email", type: "text", nullable: false },
  { name: "first_name", type: "text", nullable: true },
  { name: "last_name", type: "text", nullable: true },
  { name: "total_spent", type: "numeric", nullable: true },
  { name: "orders_count", type: "integer", nullable: true },
  { name: "created_at", type: "timestamp with time zone", nullable: false },
  { name: "tags", type: "jsonb", nullable: true },
  { name: "default_address", type: "jsonb", nullable: true },
  { name: "accepts_marketing", type: "boolean", nullable: true },
];

const testSchemaMap = makeSchemaMap({
  ecom_customers: ECOM_CUSTOMER_COLUMNS,
});

describe("formatResults", () => {
  it("returns 'No results found.' for empty data", () => {
    const result = formatResults([], testSchemaMap, ["ecom_customers"]);
    expect(result).toBe("No results found.");
  });

  it("formats a single row as key-value pairs", () => {
    const data = [
      {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        total_spent: 1234.56,
        orders_count: 15,
      },
    ];

    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    expect(result).toContain("**First Name**: Jane");
    expect(result).toContain("**Last Name**: Doe");
    expect(result).toContain("**Email**: jane@example.com");
    // total_spent should be currency formatted
    expect(result).toContain("$1,234.56");
    expect(result).toContain("**Orders Count**: 15");
  });

  it("formats multiple rows as a markdown table", () => {
    const data = [
      { first_name: "Jane", total_spent: 500 },
      { first_name: "John", total_spent: 300 },
      { first_name: "Alice", total_spent: 800 },
    ];

    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    // Should contain INLINE_TABLE marker
    expect(result).toContain("<!--INLINE_TABLE:3-->");
    // Should have markdown table syntax
    expect(result).toContain("|");
    expect(result).toContain("First Name");
    expect(result).toContain("Total Spent");
    expect(result).toContain("Jane");
    expect(result).toContain("$500.00");
  });

  it("formats boolean values as Yes/No", () => {
    const data = [{ accepts_marketing: true }];
    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    expect(result).toContain("Yes");
  });

  it("truncates UUID values", () => {
    const data = [{ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }];
    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    expect(result).toContain("a1b2c3d4...");
    expect(result).not.toContain("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("handles null values gracefully", () => {
    const data = [{ first_name: "Jane", last_name: null }];
    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    expect(result).toContain("Jane");
    // null values should be skipped in single-row format
    expect(result).not.toContain("Last Name");
  });

  it("handles JSONB values", () => {
    const data = [{ tags: ["vip", "loyal"] }];
    const result = formatResults(data, testSchemaMap, ["ecom_customers"]);
    expect(result).toContain("vip");
    expect(result).toContain("loyal");
  });

  it("works with unknown columns (infers from value)", () => {
    const emptySchema = makeSchemaMap({});
    const data = [
      { customer_name: "Jane", total_revenue: 1000 },
      { customer_name: "John", total_revenue: 500 },
    ];

    const result = formatResults(data, emptySchema, []);
    // Should still render, using inference
    expect(result).toContain("Jane");
    expect(result).toContain("John");
    // total_revenue should be inferred as currency
    expect(result).toContain("$1,000.00");
  });
});

describe("generateResultSummary", () => {
  it("summarizes empty results", () => {
    const summary = generateResultSummary([], "top customers");
    expect(summary).toBe("No results found for: top customers");
  });

  it("includes row count and column names", () => {
    const data = [
      { name: "Jane", total_spent: 1000 },
      { name: "John", total_spent: 500 },
    ];

    const summary = generateResultSummary(data, "top 2 customers");
    expect(summary).toContain("Query: top 2 customers");
    expect(summary).toContain("Results: 2 row(s)");
    expect(summary).toContain("Columns: name, total_spent");
  });

  it("includes preview of first 3 rows", () => {
    const data = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
      { name: "Diana" },
      { name: "Eve" },
    ];

    const summary = generateResultSummary(data, "all customers");
    expect(summary).toContain("Row 1: Alice");
    expect(summary).toContain("Row 2: Bob");
    expect(summary).toContain("Row 3: Charlie");
    expect(summary).not.toContain("Row 4");
    expect(summary).toContain("... and 2 more rows");
  });

  it("truncates long values in preview", () => {
    const longValue = "A".repeat(100);
    const data = [{ description: longValue }];

    const summary = generateResultSummary(data, "test");
    // Value should be truncated to 50 chars
    expect(summary).toContain("A".repeat(50));
    expect(summary).not.toContain("A".repeat(51));
  });

  it("handles null values in preview", () => {
    const data = [{ name: "Jane", email: null }];
    const summary = generateResultSummary(data, "test");
    expect(summary).toContain("Jane");
    // null values should be filtered out
  });

  it("handles object values in preview", () => {
    const data = [{ address: { city: "NYC", zip: "10001" } }];
    const summary = generateResultSummary(data, "test");
    expect(summary).toContain("city");
    expect(summary).toContain("NYC");
  });
});
