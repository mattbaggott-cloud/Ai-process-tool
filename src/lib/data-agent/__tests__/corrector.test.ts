/**
 * Tests for Corrector — pure utility functions only.
 * extractEntityIds and extractKeyValues are pure; the main
 * executeAndCorrect function requires Supabase + LLM so is not tested here.
 */

import { describe, it, expect } from "vitest";
import { extractEntityIds, extractKeyValues } from "../corrector";

describe("extractEntityIds", () => {
  it("returns empty array for empty data", () => {
    expect(extractEntityIds([])).toEqual([]);
  });

  it("extracts 'id' column values", () => {
    const data = [
      { id: "uuid-1", name: "Alice" },
      { id: "uuid-2", name: "Bob" },
      { id: "uuid-3", name: "Charlie" },
    ];
    expect(extractEntityIds(data)).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
  });

  it("extracts 'customer_id' column values", () => {
    const data = [
      { customer_id: "c1", total: 100 },
      { customer_id: "c2", total: 200 },
    ];
    expect(extractEntityIds(data)).toEqual(["c1", "c2"]);
  });

  it("extracts 'contact_id' column values", () => {
    const data = [
      { contact_id: "ct1", name: "Jane" },
      { contact_id: "ct2", name: "John" },
    ];
    expect(extractEntityIds(data)).toEqual(["ct1", "ct2"]);
  });

  it("extracts 'deal_id' column values", () => {
    const data = [
      { deal_id: "d1", value: 5000 },
    ];
    expect(extractEntityIds(data)).toEqual(["d1"]);
  });

  it("prefers 'id' over other ID columns (first match wins per row)", () => {
    const data = [
      { id: "primary-id", customer_id: "c1" },
    ];
    // The code iterates idColumns in order: id, customer_id, ...
    // and breaks on first match per row
    expect(extractEntityIds(data)).toEqual(["primary-id"]);
  });

  it("skips rows without any ID column", () => {
    const data = [
      { name: "Alice", total: 100 },
      { id: "uuid-1", name: "Bob" },
    ];
    expect(extractEntityIds(data)).toEqual(["uuid-1"]);
  });

  it("skips non-string ID values", () => {
    const data = [
      { id: 12345, name: "Numeric ID" },
    ];
    expect(extractEntityIds(data)).toEqual([]);
  });
});

describe("extractKeyValues", () => {
  it("returns empty object for empty data", () => {
    expect(extractKeyValues([])).toEqual({});
  });

  it("extracts zip values", () => {
    const data = [
      { name: "Alice", zip: "10001" },
      { name: "Bob", zip: "10002" },
    ];
    const result = extractKeyValues(data);
    expect(result.zip).toEqual(["10001", "10002"]);
  });

  it("extracts city values", () => {
    const data = [
      { city: "New York" },
      { city: "Los Angeles" },
    ];
    const result = extractKeyValues(data);
    expect(result.city).toEqual(["New York", "Los Angeles"]);
  });

  it("extracts email values", () => {
    const data = [
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: "Bob" },
    ];
    const result = extractKeyValues(data);
    expect(result.email).toBeDefined();
    expect(result.email).toContain("alice@example.com");
  });

  it("extracts name values", () => {
    const data = [
      { first_name: "Alice", total: 100 },
      { first_name: "Bob", total: 200 },
    ];
    const result = extractKeyValues(data);
    expect(result.first_name).toBeDefined();
    expect(result.first_name).toEqual(["Alice", "Bob"]);
  });

  it("does NOT extract non-reference columns", () => {
    const data = [
      { id: "uuid-1", orders_count: 5, total_spent: 100 },
    ];
    const result = extractKeyValues(data);
    // id, orders_count, total_spent are not in the extractable list
    expect(result.orders_count).toBeUndefined();
    expect(result.total_spent).toBeUndefined();
  });

  it("filters out null and undefined values", () => {
    const data = [
      { zip: "10001" },
      { zip: null },
      { zip: "10003" },
    ];
    const result = extractKeyValues(data);
    // Null values should not appear in results
    expect(result.zip).not.toContain(null);
  });
});
