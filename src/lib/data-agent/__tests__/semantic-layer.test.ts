/**
 * Tests for Semantic Layer — pure-logic functions for term matching,
 * domain classification, relationship paths, and JSONB pattern lookup.
 */

import { describe, it, expect } from "vitest";
import {
  loadSemanticLayer,
  findTermMatches,
  getRelationshipPath,
  findJoinPath,
  getDomainForQuestion,
  findJsonbPatterns,
} from "../semantic-layer";

const layer = loadSemanticLayer();

describe("loadSemanticLayer", () => {
  it("returns a layer with all expected domains", () => {
    expect(layer.domains).toBeDefined();
    expect(Object.keys(layer.domains)).toContain("ecommerce");
    expect(Object.keys(layer.domains)).toContain("crm");
    expect(Object.keys(layer.domains)).toContain("campaigns");
    expect(Object.keys(layer.domains)).toContain("behavioral");
    expect(Object.keys(layer.domains)).toContain("identity");
  });

  it("has terms, metrics, relationships, and jsonb_patterns", () => {
    expect(layer.terms.length).toBeGreaterThan(0);
    expect(layer.metrics.length).toBeGreaterThan(0);
    expect(layer.relationships.length).toBeGreaterThan(0);
    expect(layer.jsonb_patterns.length).toBeGreaterThan(0);
  });
});

describe("findTermMatches", () => {
  it("matches VIP customer terms", () => {
    const matches = findTermMatches("show me VIP customers", layer);
    expect(matches.length).toBeGreaterThan(0);
    const vipMatch = matches.find((m) => m.sql_condition.includes("total_spent > 500"));
    expect(vipMatch).toBeDefined();
    expect(vipMatch!.table).toBe("ecom_customers");
  });

  it("matches new customer / first-time buyer terms", () => {
    const matches = findTermMatches("how many first-time buyers last month", layer);
    const match = matches.find((m) => m.sql_condition.includes("orders_count = 1"));
    expect(match).toBeDefined();
    expect(match!.table).toBe("ecom_customers");
  });

  it("matches repeat customer terms", () => {
    const matches = findTermMatches("show repeat customers", layer);
    const match = matches.find((m) => m.sql_condition.includes("orders_count > 1"));
    expect(match).toBeDefined();
  });

  it("matches CRM deal stage terms", () => {
    const matches = findTermMatches("show me open deals in the pipeline", layer);
    const match = matches.find((m) => m.table === "crm_deals");
    expect(match).toBeDefined();
  });

  it("matches metric aliases (AOV)", () => {
    const matches = findTermMatches("what is the AOV", layer);
    const match = matches.find((m) => m.sql_condition.includes("AVG"));
    expect(match).toBeDefined();
    expect(match!.table).toBe("ecom_orders");
  });

  it("matches metric aliases (total revenue)", () => {
    const matches = findTermMatches("show total revenue", layer);
    const match = matches.find((m) => m.sql_condition.includes("SUM"));
    expect(match).toBeDefined();
  });

  it("returns empty for unrecognized questions", () => {
    const matches = findTermMatches("what is the meaning of life", layer);
    expect(matches.length).toBe(0);
  });

  it("matches product search terms (steak)", () => {
    const matches = findTermMatches("customers who ordered steak", layer);
    const match = matches.find((m) => m.sql_condition.includes("ILIKE"));
    expect(match).toBeDefined();
    expect(match!.table).toBe("ecom_orders");
  });
});

describe("getRelationshipPath", () => {
  it("finds direct path from ecom_customers to ecom_orders", () => {
    const path = getRelationshipPath("ecom_customers", "ecom_orders", layer);
    expect(path).not.toBeNull();
    expect(path).toContain("JOIN ecom_orders");
    expect(path).toContain("customer_id");
  });

  it("finds direct path from crm_contacts to crm_deals", () => {
    const path = getRelationshipPath("crm_contacts", "crm_deals", layer);
    expect(path).not.toBeNull();
    expect(path).toContain("JOIN crm_deals");
  });

  it("returns null for non-existent direct path", () => {
    const path = getRelationshipPath("ecom_orders", "crm_deals", layer);
    expect(path).toBeNull();
  });

  it("returns null for reversed path not in definitions", () => {
    // ecom_orders -> ecom_customers is not defined (only customers -> orders)
    const path = getRelationshipPath("ecom_orders", "ecom_customers", layer);
    expect(path).toBeNull();
  });
});

describe("findJoinPath", () => {
  it("returns empty array for same table", () => {
    const path = findJoinPath("ecom_customers", "ecom_customers", layer);
    expect(path).toEqual([]);
  });

  it("finds direct path", () => {
    const path = findJoinPath("ecom_customers", "ecom_orders", layer);
    expect(path.length).toBe(1);
    expect(path[0]).toContain("JOIN ecom_orders");
  });

  it("finds multi-hop path from ecom_customers to segments", () => {
    const path = findJoinPath("ecom_customers", "segments", layer);
    expect(path.length).toBe(2); // customers -> segment_members -> segments
    expect(path[0]).toContain("segment_members");
    expect(path[1]).toContain("segments");
  });

  it("finds multi-hop path from ecom_customers to crm_contacts (via identity links)", () => {
    const path = findJoinPath("ecom_customers", "crm_contacts", layer);
    expect(path.length).toBe(2); // customers -> identity_links -> crm_contacts
    expect(path[0]).toContain("customer_identity_links");
    expect(path[1]).toContain("crm_contacts");
  });

  it("returns empty for unreachable tables", () => {
    // crm_deals -> ecom_orders has no path in directed graph
    const path = findJoinPath("crm_deals", "ecom_orders", layer);
    expect(path).toEqual([]);
  });
});

describe("getDomainForQuestion", () => {
  it("classifies ecommerce questions", () => {
    expect(getDomainForQuestion("top 5 customers by spend", layer)).toBe("ecommerce");
    expect(getDomainForQuestion("show recent orders", layer)).toBe("ecommerce");
  });

  it("classifies CRM questions", () => {
    expect(getDomainForQuestion("list all open deals in pipeline", layer)).toBe("crm");
    expect(getDomainForQuestion("show my contacts at HubSpot", layer)).toBe("crm");
  });

  it("classifies campaign questions", () => {
    expect(getDomainForQuestion("what is the open rate for campaigns", layer)).toBe("campaigns");
  });

  it("classifies behavioral questions", () => {
    expect(getDomainForQuestion("show me churned customers by lifecycle stage", layer)).toBe("behavioral");
  });

  it("returns 'all' for ambiguous questions", () => {
    const domain = getDomainForQuestion("show me everything", layer);
    expect(domain).toBe("all");
  });
});

describe("findJsonbPatterns", () => {
  it("finds zip code pattern", () => {
    const patterns = findJsonbPatterns("what are their zip codes", layer);
    expect(patterns.length).toBeGreaterThan(0);
    const zipPattern = patterns.find((p) => p.column === "default_address");
    expect(zipPattern).toBeDefined();
    expect(zipPattern!.table).toBe("ecom_customers");
  });

  it("finds city pattern", () => {
    const patterns = findJsonbPatterns("customers in which city", layer);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("finds line_items pattern", () => {
    const patterns = findJsonbPatterns("show me the line_items", layer);
    expect(patterns.length).toBeGreaterThan(0);
    const lineItemPattern = patterns.find((p) => p.column === "line_items");
    expect(lineItemPattern).toBeDefined();
    expect(lineItemPattern!.table).toBe("ecom_orders");
  });

  it("finds shipping_address pattern", () => {
    const patterns = findJsonbPatterns("what province are they in", layer);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("returns empty for non-JSONB questions", () => {
    const patterns = findJsonbPatterns("how many orders last month", layer);
    expect(patterns.length).toBe(0);
  });
});
