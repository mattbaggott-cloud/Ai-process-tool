/**
 * Tests for Session — in-memory session state management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSession,
  updateSession,
  resolveReference,
  hasHistory,
  getLastTurn,
  buildSessionContext,
} from "../session";

describe("Session Management", () => {
  const orgId = "org-test-123";

  beforeEach(() => {
    // Each test gets a fresh session via unique sessionId
  });

  it("creates a new session with empty state", () => {
    const session = getSession("fresh-session", orgId);
    expect(session.session_id).toBe("fresh-session");
    expect(session.org_id).toBe(orgId);
    expect(session.current_domain).toBeNull();
    expect(session.active_entity_ids).toEqual([]);
    expect(session.queries).toEqual([]);
  });

  it("returns the same session for the same sessionId + orgId", () => {
    const s1 = getSession("same-id", orgId);
    const s2 = getSession("same-id", orgId);
    expect(s1).toBe(s2); // same object reference
  });

  it("returns different sessions for different sessionIds", () => {
    const s1 = getSession("id-a", orgId);
    const s2 = getSession("id-b", orgId);
    expect(s1).not.toBe(s2);
  });

  it("hasHistory returns false for new session", () => {
    const session = getSession("no-history", orgId);
    expect(hasHistory(session)).toBe(false);
  });

  it("hasHistory returns true after updateSession", () => {
    const session = getSession("with-history", orgId);
    updateSession(session, {
      question: "top 5 customers",
      sql: "SELECT * FROM ecom_customers LIMIT 5",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: ["id1", "id2"],
      result_values: {},
      result_summary: "5 customers returned",
      timestamp: Date.now(),
    });
    expect(hasHistory(session)).toBe(true);
  });

  it("getLastTurn returns the most recent turn", () => {
    const session = getSession("last-turn-test", orgId);
    updateSession(session, {
      question: "first question",
      sql: "SELECT 1",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: [],
      result_values: {},
      result_summary: "first",
      timestamp: Date.now(),
    });
    updateSession(session, {
      question: "second question",
      sql: "SELECT 2",
      tables: ["ecom_orders"],
      domain: "ecommerce",
      entity_ids: ["order1"],
      result_values: {},
      result_summary: "second",
      timestamp: Date.now(),
    });

    const last = getLastTurn(session);
    expect(last?.question).toBe("second question");
    expect(last?.sql).toBe("SELECT 2");
  });

  it("updateSession sets active entity IDs and domain", () => {
    const session = getSession("entity-test", orgId);
    updateSession(session, {
      question: "top customers",
      sql: "SELECT *",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: ["c1", "c2", "c3"],
      result_values: { zip: ["10001", "10002"] },
      result_summary: "3 customers",
      timestamp: Date.now(),
    });

    expect(session.current_domain).toBe("ecommerce");
    expect(session.active_entity_ids).toEqual(["c1", "c2", "c3"]);
  });
});

describe("resolveReference", () => {
  const orgId = "org-resolve-test";

  it("returns null for empty session", () => {
    const session = getSession("empty-resolve", orgId);
    expect(resolveReference(session, "what are their zip codes")).toBeNull();
  });

  it("resolves pronoun to active entity IDs", () => {
    const session = getSession("pronoun-resolve", orgId);
    updateSession(session, {
      question: "top 5 customers",
      sql: "SELECT *",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: ["c1", "c2", "c3"],
      result_values: {},
      result_summary: "3 customers",
      timestamp: Date.now(),
    });

    const resolved = resolveReference(session, "what are their orders");
    expect(resolved).toEqual(["c1", "c2", "c3"]);
  });

  it("resolves specific value keys from result_values", () => {
    const session = getSession("value-resolve", orgId);
    updateSession(session, {
      question: "show customers and zips",
      sql: "SELECT *",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: ["c1"],
      result_values: { zip: ["10001", "10002", "10003"] },
      result_summary: "customers with zips",
      timestamp: Date.now(),
    });

    const resolved = resolveReference(session, "those zip codes");
    expect(resolved).toEqual(["10001", "10002", "10003"]);
  });
});

describe("buildSessionContext", () => {
  const orgId = "org-context-test";

  it("returns null for empty session", () => {
    const session = getSession("empty-context", orgId);
    expect(buildSessionContext(session)).toBeNull();
  });

  it("includes domain and turn summaries", () => {
    const session = getSession("context-build", orgId);
    updateSession(session, {
      question: "top 5 customers by spend",
      sql: "SELECT * FROM ecom_customers ORDER BY total_spent DESC LIMIT 5",
      tables: ["ecom_customers"],
      domain: "ecommerce",
      entity_ids: ["c1", "c2"],
      result_values: {},
      result_summary: "5 customers sorted by spend",
      timestamp: Date.now(),
    });

    const context = buildSessionContext(session);
    expect(context).not.toBeNull();
    expect(context).toContain("ecommerce");
    expect(context).toContain("top 5 customers by spend");
    expect(context).toContain("1 prior query turn");
  });
});
