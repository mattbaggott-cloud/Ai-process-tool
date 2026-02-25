/**
 * Tests for Question Decomposer — code guard logic.
 * Tests the deterministic guards that skip decomposition
 * for simple cases. LLM path is tested via integration tests.
 */

import { describe, it, expect } from "vitest";
import { tryDecompose } from "../decomposer";
import type { QueryPlan, SchemaMap } from "../types";
import { loadSemanticLayer } from "../semantic-layer";

/* ── Test Fixtures ────────────────────────────────────── */

const semanticLayer = loadSemanticLayer();

/** Schema with no JSONB array columns — single query always fine */
const simpleSchemaMap: SchemaMap = {
  tables: new Map([
    [
      "ecom_customers",
      {
        name: "ecom_customers",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "first_name", type: "text", nullable: true },
          { name: "total_spent", type: "numeric", nullable: true },
          { name: "default_address", type: "jsonb", nullable: true, jsonb_keys: ["city", "zip"] },
        ],
        relationships: [],
        description: "E-commerce customers",
        domain: "ecommerce",
      },
    ],
  ]),
  indexed_at: Date.now(),
};

/** Schema with JSONB array columns — might need decomposition */
const complexSchemaMap: SchemaMap = {
  tables: new Map([
    [
      "ecom_customers",
      {
        name: "ecom_customers",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "first_name", type: "text", nullable: true },
          { name: "total_spent", type: "numeric", nullable: true },
        ],
        relationships: [],
        description: "E-commerce customers",
        domain: "ecommerce",
      },
    ],
    [
      "ecom_orders",
      {
        name: "ecom_orders",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "customer_id", type: "uuid", nullable: false },
          { name: "total_price", type: "numeric", nullable: true },
          { name: "line_items", type: "jsonb", nullable: true },
        ],
        relationships: [
          { target_table: "ecom_customers", source_column: "customer_id", target_column: "id" },
        ],
        description: "E-commerce orders",
        domain: "ecommerce",
      },
    ],
  ]),
  indexed_at: Date.now(),
};

function mockPlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    turn_type: "new",
    intent: "test",
    domain: "ecommerce",
    ambiguous: false,
    tables_needed: ["ecom_customers"],
    resolved_references: {},
    ...overrides,
  };
}

/* ── Code Guard Tests ─────────────────────────────────── */

describe("tryDecompose — code guards", () => {
  it("returns null for ambiguous questions", async () => {
    const result = await tryDecompose(
      "show me customers",
      mockPlan({ ambiguous: true, needs_clarification: "Which customers?" }),
      semanticLayer,
      simpleSchemaMap
    );
    expect(result).toBeNull();
  });

  it("returns null for single table with no JSONB arrays", async () => {
    const result = await tryDecompose(
      "top 5 customers by spend",
      mockPlan({ tables_needed: ["ecom_customers"] }),
      semanticLayer,
      simpleSchemaMap
    );
    expect(result).toBeNull();
  });

  it("returns null for single table even with JSONB object columns (not arrays)", async () => {
    // default_address is JSONB but not an array column — no unnesting needed
    const result = await tryDecompose(
      "customers with their city and zip",
      mockPlan({ tables_needed: ["ecom_customers"] }),
      semanticLayer,
      simpleSchemaMap
    );
    expect(result).toBeNull();
  });

  it("returns null when plan has needs_clarification set", async () => {
    const result = await tryDecompose(
      "show me deals",
      mockPlan({
        ambiguous: false,
        needs_clarification: "Do you mean CRM deals or ecommerce orders?",
      }),
      semanticLayer,
      simpleSchemaMap
    );
    expect(result).toBeNull();
  });
});
