/**
 * Tests for Presenter — template selection, confidence annotation,
 * and output building. Pure unit tests, no DB/LLM.
 */

import { describe, it, expect } from "vitest";
import { presentResults } from "../presenter";
import type { QueryPlan, QueryResult, SchemaMap, FieldConfidence } from "../types";

/* ── Helpers ──────────────────────────────────────────── */

function mockPlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    turn_type: "new",
    intent: "show data",
    domain: "ecommerce",
    ambiguous: false,
    tables_needed: ["ecom_customers"],
    resolved_references: {},
    ...overrides,
  };
}

function mockResult(
  data: Record<string, unknown>[],
  overrides: Partial<QueryResult> = {}
): QueryResult {
  return {
    success: true,
    sql: "SELECT 1",
    data,
    row_count: data.length,
    execution_time_ms: 50,
    formatted_message: "",
    ...overrides,
  };
}

const emptySchemaMap: SchemaMap = { tables: new Map(), indexed_at: 0 };

/* ── Template Selection ──────────────────────────────── */

describe("presentResults — template selection", () => {
  it("selects customer_profile for single row with customer fields", () => {
    const result = mockResult([
      { first_name: "Alice", last_name: "Smith", email: "alice@test.com", total_spent: 500, orders_count: 10 },
    ]);
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization).toBeDefined();
    expect(result.visualization!.type).toBe("profile");
    expect(result.visualization!.profile_sections).toBeDefined();
    expect(result.visualization!.profile_sections!.length).toBeGreaterThan(0);
  });

  it("selects detail_card for single row without customer context", () => {
    const result = mockResult([
      { deal_name: "Big Deal", amount: 50000, stage: "negotiation" },
    ]);
    const plan = mockPlan({ intent: "show deal details" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization).toBeDefined();
    expect(result.visualization!.type).toBe("profile"); // detail_card uses profile type
    expect(result.visualization!.profile_sections).toBeDefined();
    expect(result.visualization!.profile_sections![0].title).toBe("Details");
  });

  it("selects ranked_list for top N with numeric data", () => {
    const result = mockResult([
      { name: "Alice", total_spent: 500 },
      { name: "Bob", total_spent: 400 },
      { name: "Charlie", total_spent: 300 },
    ]);
    const plan = mockPlan({ intent: "top 3 customers by spend" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization).toBeDefined();
    // ranked_list uses bar chart under the hood
    expect(result.visualization!.type).toBe("chart");
    expect(result.visualization!.chart_type).toBe("bar");
  });

  it("selects metric_summary for aggregate single-row results", () => {
    const result = mockResult([
      { total_orders: 150, total_revenue: 75000 },
    ]);
    const plan = mockPlan({ intent: "how many total orders and revenue" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization).toBeDefined();
    expect(result.visualization!.type).toBe("metric");
    expect(result.visualization!.metric_cards).toBeDefined();
    expect(result.visualization!.metric_cards!.length).toBe(2);
  });

  it("uses auto template for large datasets", () => {
    const data = Array.from({ length: 25 }, (_, i) => ({
      name: `Customer ${i}`,
      total_spent: (i + 1) * 100,
    }));
    const result = mockResult(data);
    const plan = mockPlan({ intent: "list all customers" });

    presentResults(result, plan, emptySchemaMap);

    // Auto template falls through, existing chart/table logic handles it
    expect(result.visualization).toBeDefined();
    expect(result.visualization!.type).toBe("table");
  });

  it("respects explicit output_template on plan", () => {
    const result = mockResult([
      { count: 42, avg_value: 150 },
    ]);
    const plan = mockPlan({
      intent: "show aggregates",
      output_template: "metric_summary",
    });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization).toBeDefined();
    expect(result.visualization!.type).toBe("metric");
  });
});

/* ── Customer Profile Sections ───────────────────────── */

describe("presentResults — customer profile", () => {
  it("categorizes fields into overview, purchase, and behavioral sections", () => {
    const result = mockResult([
      {
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@test.com",
        city: "NYC",
        total_spent: 1200,
        orders_count: 15,
        lifecycle_stage: "active",
        engagement_score: 0.85,
      },
    ]);
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    const sections = result.visualization!.profile_sections!;
    expect(sections.length).toBeGreaterThanOrEqual(3);

    const overviewSection = sections.find((s) => s.title === "Overview");
    expect(overviewSection).toBeDefined();
    expect(overviewSection!.fields.some((f) => f.label.includes("Email"))).toBe(true);

    const purchaseSection = sections.find((s) => s.title === "Purchase History");
    expect(purchaseSection).toBeDefined();
    expect(purchaseSection!.fields.some((f) => f.label.includes("Total Spent"))).toBe(true);

    const behavioralSection = sections.find((s) => s.title === "Behavioral Profile");
    expect(behavioralSection).toBeDefined();
    expect(behavioralSection!.fields.some((f) => f.label.includes("Lifecycle Stage"))).toBe(true);
  });

  it("uses customer name as title", () => {
    const result = mockResult([
      { first_name: "Alice", last_name: "Smith", email: "alice@test.com" },
    ]);
    const plan = mockPlan({ intent: "show customer" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.visualization!.title).toBe("Alice Smith");
  });

  it("attaches confidence from field_confidence metadata", () => {
    const fieldConfidence: FieldConfidence[] = [
      { field: "lifecycle_stage", confidence: "ai_inferred", source_table: "customer_behavioral_profiles" },
    ];
    const result = mockResult(
      [{ first_name: "Alice", email: "a@t.com", lifecycle_stage: "active" }],
      { field_confidence: fieldConfidence }
    );
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    const sections = result.visualization!.profile_sections!;
    const behavioralSection = sections.find((s) => s.title === "Behavioral Profile");
    expect(behavioralSection).toBeDefined();
    const lifecycleField = behavioralSection!.fields.find((f) => f.label.includes("Lifecycle Stage"));
    expect(lifecycleField).toBeDefined();
    expect(lifecycleField!.confidence).toBe("ai_inferred");
  });
});

/* ── Metric Summary ──────────────────────────────────── */

describe("presentResults — metric summary", () => {
  it("creates metric cards for each numeric column", () => {
    const result = mockResult([
      { order_count: 150, total_revenue: 75000, avg_order_value: 500 },
    ]);
    const plan = mockPlan({ intent: "how many total orders and revenue" });

    presentResults(result, plan, emptySchemaMap);

    const cards = result.visualization!.metric_cards!;
    expect(cards.length).toBe(3);
    expect(cards[0].label).toContain("Order Count");
    expect(cards[0].value).toBe("150");
  });

  it("aggregates across multiple rows", () => {
    const result = mockResult([
      { region: "East", revenue: 30000 },
      { region: "West", revenue: 45000 },
    ]);
    const plan = mockPlan({ intent: "total revenue by region" });

    presentResults(result, plan, emptySchemaMap);

    // With "total" in intent and ≤3 rows, should be metric_summary
    const cards = result.visualization!.metric_cards!;
    expect(cards.length).toBe(1);
    expect(cards[0].label).toContain("Revenue");
  });
});

/* ── Confidence Annotation ───────────────────────────── */

describe("presentResults — confidence annotation", () => {
  it("annotates narrative with AI-inferred markers", () => {
    const fieldConfidence: FieldConfidence[] = [
      { field: "lifecycle_stage", confidence: "ai_inferred" },
      { field: "communication_style", confidence: "ai_inferred" },
    ];
    const result = mockResult(
      [
        {
          first_name: "Alice",
          lifecycle_stage: "active",
          communication_style: "formal",
        },
      ],
      { field_confidence: fieldConfidence }
    );
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.narrative_summary).toBeDefined();
    expect(result.narrative_summary).toContain("_(AI-inferred)_");
    expect(result.narrative_summary).toContain("AI-generated");
  });

  it("does not annotate verified fields", () => {
    const fieldConfidence: FieldConfidence[] = [
      { field: "total_spent", confidence: "verified" },
    ];
    const result = mockResult(
      [{ first_name: "Alice", total_spent: 500 }],
      { field_confidence: fieldConfidence }
    );
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.narrative_summary).toBeDefined();
    expect(result.narrative_summary).not.toContain("_(AI-inferred)_");
    expect(result.narrative_summary).not.toContain("AI-generated");
  });

  it("skips annotation when no field_confidence present", () => {
    const result = mockResult([
      { first_name: "Alice", total_spent: 500 },
    ]);
    const plan = mockPlan({ intent: "show customer Alice" });

    presentResults(result, plan, emptySchemaMap);

    expect(result.narrative_summary).toBeDefined();
    expect(result.narrative_summary).not.toContain("_(AI-inferred)_");
  });
});

/* ── Row Count Validation ────────────────────────────── */

describe("presentResults — row count validation", () => {
  it("requests retry when SQL LIMIT is too low", () => {
    const result = mockResult(
      [{ name: "Alice", total_spent: 500 }],
      { sql: "SELECT * FROM ecom_customers LIMIT 1" }
    );
    const plan = mockPlan({ intent: "top 5 customers", expected_count: 5 });

    const check = presentResults(result, plan, emptySchemaMap);

    expect(check.needsRetry).toBe(true);
    expect(check.reason).toContain("LIMIT");
  });

  it("does not retry when data just has fewer rows than expected", () => {
    const result = mockResult(
      [{ name: "Alice", total_spent: 500 }, { name: "Bob", total_spent: 300 }],
      { sql: "SELECT * FROM ecom_customers LIMIT 5" }
    );
    const plan = mockPlan({ intent: "top 5 customers", expected_count: 5 });

    const check = presentResults(result, plan, emptySchemaMap);

    expect(check.needsRetry).toBe(false);
  });
});

/* ── Edge Cases ──────────────────────────────────────── */

describe("presentResults — edge cases", () => {
  it("handles empty results gracefully", () => {
    const result = mockResult([], { success: true });
    const plan = mockPlan({ intent: "show customers" });

    const check = presentResults(result, plan, emptySchemaMap);

    expect(check.needsRetry).toBe(false);
    expect(result.visualization).toBeUndefined();
  });

  it("handles failed results gracefully", () => {
    const result = mockResult([], { success: false, error: "timeout" });
    const plan = mockPlan({ intent: "show customers" });

    const check = presentResults(result, plan, emptySchemaMap);

    expect(check.needsRetry).toBe(false);
    expect(result.visualization).toBeUndefined();
  });

  it("filters out UUID columns from profile display", () => {
    const result = mockResult([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        org_id: "org-123-uuid-value",
        first_name: "Alice",
        email: "alice@test.com",
      },
    ]);
    const plan = mockPlan({ intent: "show customer" });

    presentResults(result, plan, emptySchemaMap);

    const sections = result.visualization!.profile_sections!;
    const allFields = sections.flatMap((s) => s.fields);
    expect(allFields.some((f) => f.label === "ID")).toBe(false);
    expect(allFields.some((f) => f.label === "Org ID")).toBe(false);
  });
});
