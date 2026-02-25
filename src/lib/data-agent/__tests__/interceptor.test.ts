/**
 * Tests for Tool Interceptor — deterministic tool routing logic.
 * All functions are pure, no network dependencies.
 */

import { describe, it, expect } from "vitest";
import { interceptToolCall } from "../tool-interceptor";

describe("interceptToolCall", () => {
  describe("data_read tools get intercepted", () => {
    it("intercepts query_ecommerce", () => {
      const result = interceptToolCall(
        "query_ecommerce",
        { entity_type: "customers", limit: 5 },
        "top 5 customers by spend"
      );
      expect(result.intercepted).toBe(true);
      expect(result.toolName).toBe("analyze_data");
      expect(result.originalTool).toBe("query_ecommerce");
      expect(result.input.question).toBe("top 5 customers by spend");
    });

    it("intercepts search_crm", () => {
      const result = interceptToolCall(
        "search_crm",
        { entity_type: "deals", query: "open deals" },
        "show me open deals"
      );
      expect(result.intercepted).toBe(true);
      expect(result.toolName).toBe("analyze_data");
      expect(result.originalTool).toBe("search_crm");
    });

    it("intercepts search_order_line_items", () => {
      const result = interceptToolCall(
        "search_order_line_items",
        { search_terms: ["steak"] },
        "find orders with steak"
      );
      expect(result.intercepted).toBe(true);
      expect(result.toolName).toBe("analyze_data");
    });

    it("intercepts search_tool_results", () => {
      const result = interceptToolCall(
        "search_tool_results",
        { query: "previous data" },
        "search previous results"
      );
      expect(result.intercepted).toBe(true);
      expect(result.toolName).toBe("analyze_data");
    });
  });

  describe("non-data_read tools pass through", () => {
    it("does NOT intercept analyze_data (data_agent category)", () => {
      const result = interceptToolCall(
        "analyze_data",
        { question: "top customers" }
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("analyze_data");
    });

    it("does NOT intercept query_ecommerce_analytics (analytics category)", () => {
      const result = interceptToolCall(
        "query_ecommerce_analytics",
        { metric: "revenue" }
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("query_ecommerce_analytics");
    });

    it("does NOT intercept create_segment (data_write category)", () => {
      const result = interceptToolCall(
        "create_segment",
        { name: "VIP", criteria: {} }
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("create_segment");
    });

    it("does NOT intercept create_inline_table (render category)", () => {
      const result = interceptToolCall(
        "create_inline_table",
        { data: [] }
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("create_inline_table");
    });

    it("does NOT intercept unknown tools (no category)", () => {
      const result = interceptToolCall(
        "some_unknown_tool",
        { foo: "bar" }
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("some_unknown_tool");
    });
  });

  describe("user question preference", () => {
    it("uses user question over extracted question when provided", () => {
      const result = interceptToolCall(
        "query_ecommerce",
        { entity_type: "customers", limit: 10 },
        "who are my top 10 biggest spenders?"
      );
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toBe("who are my top 10 biggest spenders?");
    });

    it("falls back to extracted question when no user question", () => {
      const result = interceptToolCall(
        "query_ecommerce",
        { entity_type: "customers", sort_by: "total_spent", limit: 5 }
      );
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toContain("customers");
      expect(result.input.question).toContain("sorted by total_spent");
      expect(result.input.question).toContain("limit 5");
    });

    it("does not intercept when no question can be extracted", () => {
      const result = interceptToolCall(
        "search_order_line_items",
        {} // No search_terms or customer_id
      );
      expect(result.intercepted).toBe(false);
    });
  });

  describe("bypass flag", () => {
    it("skips interception when bypassInterception is true", () => {
      const result = interceptToolCall(
        "query_ecommerce",
        { entity_type: "customers" },
        "top customers",
        true // bypass
      );
      expect(result.intercepted).toBe(false);
      expect(result.toolName).toBe("query_ecommerce");
      expect(result.originalTool).toBe("query_ecommerce");
    });

    it("still routes normally when bypassInterception is false", () => {
      const result = interceptToolCall(
        "query_ecommerce",
        { entity_type: "customers" },
        "top customers",
        false
      );
      expect(result.intercepted).toBe(true);
      expect(result.toolName).toBe("analyze_data");
    });
  });

  describe("question extraction from legacy tool params", () => {
    it("extracts question from query_ecommerce with search_query", () => {
      const result = interceptToolCall("query_ecommerce", {
        search_query: "VIP customers in New York",
      });
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toContain("VIP customers in New York");
    });

    it("extracts question from query_ecommerce with filters", () => {
      const result = interceptToolCall("query_ecommerce", {
        entity_type: "orders",
        filters: { status: "paid" },
      });
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toContain("orders");
      expect(result.input.question).toContain("status");
    });

    it("extracts question from search_crm with query", () => {
      const result = interceptToolCall("search_crm", {
        query: "John Smith",
        entity_type: "contacts",
      });
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toContain("John Smith");
      expect(result.input.question).toContain("contacts");
    });

    it("extracts question from search_crm without query", () => {
      const result = interceptToolCall("search_crm", {
        entity_type: "deals",
      });
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toContain("deals");
    });

    it("extracts question from search_tool_results", () => {
      const result = interceptToolCall("search_tool_results", {
        query: "previous customer data",
      });
      expect(result.intercepted).toBe(true);
      expect(result.input.question).toBe("previous customer data");
    });
  });
});
