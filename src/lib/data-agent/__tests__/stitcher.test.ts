/**
 * Tests for Result Stitcher — pure unit tests, no DB/LLM.
 */

import { describe, it, expect } from "vitest";
import { stitchResults, type SubQueryResult } from "../stitcher";
import type { DecomposedPlan, QueryResult, SubQuery } from "../types";

/* ── Helpers ──────────────────────────────────────────── */

function mockQueryResult(data: Record<string, unknown>[], sql = "SELECT 1"): QueryResult {
  return {
    success: true,
    sql,
    data,
    row_count: data.length,
    execution_time_ms: 50,
    formatted_message: "",
  };
}

function mockSubQuery(id: string, joinKey: string, dependsOn?: string[]): SubQuery {
  return {
    id,
    intent: `Sub-query ${id}`,
    domain: "ecommerce",
    tables_needed: ["ecom_customers"],
    join_key: joinKey,
    depends_on: dependsOn,
    resolved_references: {},
  };
}

/* ── merge_columns ────────────────────────────────────── */

describe("stitchResults — merge_columns", () => {
  const plan: DecomposedPlan = {
    sub_queries: [],
    stitch_key: "id",
    stitch_strategy: "merge_columns",
  };

  it("merges columns from two sub-queries by stitch key", () => {
    const subResults: SubQueryResult[] = [
      {
        id: "sq_1",
        result: mockQueryResult([
          { id: "a1", name: "Alice", spend: 500 },
          { id: "b2", name: "Bob", spend: 300 },
        ]),
        subQuery: mockSubQuery("sq_1", "id"),
      },
      {
        id: "sq_2",
        result: mockQueryResult([
          { customer_id: "a1", city: "NYC", zip: "10001" },
          { customer_id: "b2", city: "LA", zip: "90001" },
        ]),
        subQuery: mockSubQuery("sq_2", "customer_id", ["sq_1"]),
      },
    ];

    const result = stitchResults(subResults, plan);

    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0]).toMatchObject({ id: "a1", name: "Alice", spend: 500, city: "NYC", zip: "10001" });
    expect(result.data[1]).toMatchObject({ id: "b2", name: "Bob", spend: 300, city: "LA", zip: "90001" });
  });

  it("handles missing matches (fills nothing for unmatched keys)", () => {
    const subResults: SubQueryResult[] = [
      {
        id: "sq_1",
        result: mockQueryResult([
          { id: "a1", name: "Alice" },
          { id: "c3", name: "Charlie" },
        ]),
        subQuery: mockSubQuery("sq_1", "id"),
      },
      {
        id: "sq_2",
        result: mockQueryResult([
          { customer_id: "a1", city: "NYC" },
          // No match for c3
        ]),
        subQuery: mockSubQuery("sq_2", "customer_id", ["sq_1"]),
      },
    ];

    const result = stitchResults(subResults, plan);
    expect(result.data.length).toBe(2);
    expect(result.data[0]).toHaveProperty("city", "NYC");
    expect(result.data[1]).not.toHaveProperty("city");
  });

  it("preserves sub_results array", () => {
    const subResults: SubQueryResult[] = [
      { id: "sq_1", result: mockQueryResult([{ id: "a1" }]), subQuery: mockSubQuery("sq_1", "id") },
      { id: "sq_2", result: mockQueryResult([{ customer_id: "a1", x: 1 }]), subQuery: mockSubQuery("sq_2", "customer_id", ["sq_1"]) },
    ];

    const result = stitchResults(subResults, plan);
    expect(result.sub_results).toHaveLength(2);
    expect(result.stitch_key).toBe("id");
  });
});

/* ── nested ───────────────────────────────────────────── */

describe("stitchResults — nested", () => {
  const plan: DecomposedPlan = {
    sub_queries: [],
    stitch_key: "id",
    stitch_strategy: "nested",
  };

  it("nests child rows as arrays", () => {
    const subResults: SubQueryResult[] = [
      {
        id: "sq_1",
        result: mockQueryResult([
          { id: "a1", name: "Alice" },
          { id: "b2", name: "Bob" },
        ]),
        subQuery: mockSubQuery("sq_1", "id"),
      },
      {
        id: "sq_2",
        result: mockQueryResult([
          { customer_id: "a1", product: "Steak", count: 3 },
          { customer_id: "a1", product: "Salmon", count: 1 },
          { customer_id: "b2", product: "Lobster", count: 2 },
        ]),
        subQuery: mockSubQuery("sq_2", "customer_id", ["sq_1"]),
      },
    ];

    const result = stitchResults(subResults, plan);

    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);

    const alice = result.data[0];
    expect(alice.name).toBe("Alice");
    const aliceProducts = alice._sq_2_data as Record<string, unknown>[];
    expect(aliceProducts).toHaveLength(2);
    expect(aliceProducts[0]).toMatchObject({ product: "Steak", count: 3 });

    const bob = result.data[1];
    const bobProducts = bob._sq_2_data as Record<string, unknown>[];
    expect(bobProducts).toHaveLength(1);
  });

  it("returns empty array for entities with no child data", () => {
    const subResults: SubQueryResult[] = [
      {
        id: "sq_1",
        result: mockQueryResult([{ id: "a1", name: "Alice" }]),
        subQuery: mockSubQuery("sq_1", "id"),
      },
      {
        id: "sq_2",
        result: mockQueryResult([]), // No products at all
        subQuery: mockSubQuery("sq_2", "customer_id", ["sq_1"]),
      },
    ];

    const result = stitchResults(subResults, plan);
    expect(result.data[0]._sq_2_data).toEqual([]);
  });
});

/* ── append_rows ──────────────────────────────────────── */

describe("stitchResults — append_rows", () => {
  const plan: DecomposedPlan = {
    sub_queries: [],
    stitch_key: "id",
    stitch_strategy: "append_rows",
  };

  it("concatenates all rows with source tag", () => {
    const subResults: SubQueryResult[] = [
      {
        id: "sq_1",
        result: mockQueryResult([
          { id: "a1", name: "Alice" },
        ]),
        subQuery: mockSubQuery("sq_1", "id"),
      },
      {
        id: "sq_2",
        result: mockQueryResult([
          { id: "d1", deal: "Big Deal" },
        ]),
        subQuery: mockSubQuery("sq_2", "id"),
      },
    ];

    const result = stitchResults(subResults, plan);
    expect(result.data.length).toBe(2);
    expect(result.data[0]._source_query).toBe("sq_1");
    expect(result.data[1]._source_query).toBe("sq_2");
  });
});

/* ── Edge cases ───────────────────────────────────────── */

describe("stitchResults — edge cases", () => {
  it("returns error result when all sub-queries failed", () => {
    const failedResult: QueryResult = {
      success: false, sql: "", data: [], row_count: 0,
      execution_time_ms: 0, formatted_message: "fail", error: "timeout",
    };

    const result = stitchResults(
      [{ id: "sq_1", result: failedResult, subQuery: mockSubQuery("sq_1", "id") }],
      { sub_queries: [], stitch_key: "id", stitch_strategy: "merge_columns" }
    );
    // Single result returns as-is
    expect(result.success).toBe(false);
  });

  it("returns empty result for no sub-queries", () => {
    const result = stitchResults(
      [],
      { sub_queries: [], stitch_key: "id", stitch_strategy: "merge_columns" }
    );
    expect(result.success).toBe(false);
  });

  it("returns single result unchanged", () => {
    const single = mockQueryResult([{ id: "a1", name: "Alice" }]);
    const result = stitchResults(
      [{ id: "sq_1", result: single, subQuery: mockSubQuery("sq_1", "id") }],
      { sub_queries: [], stitch_key: "id", stitch_strategy: "merge_columns" }
    );
    expect(result).toBe(single);
  });
});
