/**
 * Tests for Planner — pure-logic functions that don't need LLM or DB calls.
 * Tests extractExpectedCount, extractPresentationHint.
 */

import { describe, it, expect } from "vitest";
import { extractExpectedCount, extractPresentationHint } from "../planner";

describe("extractExpectedCount", () => {
  it("extracts 'top N' patterns", () => {
    expect(extractExpectedCount("top 5 customers")).toBe(5);
    expect(extractExpectedCount("show me the top 10 orders")).toBe(10);
    expect(extractExpectedCount("bottom 3 products by revenue")).toBe(3);
  });

  it("extracts 'first/last N' patterns", () => {
    expect(extractExpectedCount("first 20 customers")).toBe(20);
    expect(extractExpectedCount("last 5 orders")).toBe(5);
  });

  it("extracts 'N entities' patterns", () => {
    expect(extractExpectedCount("show me 5 customers")).toBe(5);
    expect(extractExpectedCount("give me 10 orders")).toBe(10);
    expect(extractExpectedCount("list 15 deals")).toBe(15);
  });

  it("extracts 'best/worst N' patterns", () => {
    expect(extractExpectedCount("best 3 customers by spend")).toBe(3);
    expect(extractExpectedCount("worst 5 performing products")).toBe(5);
  });

  it("returns undefined when no count found", () => {
    expect(extractExpectedCount("show me all customers")).toBeUndefined();
    expect(extractExpectedCount("what is the total revenue")).toBeUndefined();
    expect(extractExpectedCount("who are the VIP customers")).toBeUndefined();
  });
});

describe("extractPresentationHint", () => {
  it("detects chart keywords", () => {
    expect(extractPresentationHint("show me a chart of revenue")).toBe("chart");
    expect(extractPresentationHint("graph of orders by month")).toBe("chart");
    expect(extractPresentationHint("visualize customer spending")).toBe("chart");
    expect(extractPresentationHint("plot sales over time")).toBe("chart");
  });

  it("detects comparison keywords as chart", () => {
    expect(extractPresentationHint("compare Q1 vs Q2 revenue")).toBe("chart");
    expect(extractPresentationHint("side by side spending comparison")).toBe("chart");
  });

  it("detects table keywords", () => {
    expect(extractPresentationHint("show me a table of customers")).toBe("table");
    expect(extractPresentationHint("list all orders")).toBe("table");
    expect(extractPresentationHint("give me a breakdown of spend")).toBe("table");
  });

  it("detects detail keywords", () => {
    expect(extractPresentationHint("tell me about customer 123")).toBe("detail");
    expect(extractPresentationHint("deep dive into this account")).toBe("detail");
    expect(extractPresentationHint("give me the profile of John")).toBe("detail");
  });

  it("returns auto for ambiguous questions", () => {
    expect(extractPresentationHint("top 5 customers by spend")).toBe("auto");
    expect(extractPresentationHint("how many orders last month")).toBe("auto");
    expect(extractPresentationHint("what is the average order value")).toBe("auto");
  });
});
