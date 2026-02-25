/**
 * Planner — classifies user intent and builds a query plan
 *
 * Uses Haiku (fast, cheap) to:
 * 1. Classify turn type: new, follow_up, pivot, refinement
 * 2. Detect domain ambiguity (e.g., "customers" when both B2B and B2C exist)
 * 3. Detect term ambiguity (e.g., "VIP" with no definition in memories)
 * 4. Resolve coreferences ("their", "those") against session state
 * 5. Build a QueryPlan for the downstream pipeline
 *
 * Memory-driven learning loop:
 * - Retrieves org-scoped memories for term definitions
 * - When a term is ambiguous and has no memory, asks the user
 * - The user's answer gets stored as a memory via extractMemories()
 * - Next time that term is used, the memory is found and no question is needed
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryPlan, DataAgentSession, SemanticLayer, SchemaMap, PresentationHint, StructuredClarification, DecomposedPlan } from "./types";
import { retrieveMemories, type RetrievedMemory } from "../agentic/memory-retriever";
import { getAvailableDomains, getTablesForDomain } from "./schema-introspect";
import { findTermMatches, getDomainForQuestion } from "./semantic-layer";
import { resolveReference, hasHistory, getLastTurn, buildSessionContext } from "./session";

/* ── Constants ───────────────────────────────────────── */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/* ── Planner Prompt ──────────────────────────────────── */

function buildPlannerPrompt(
  availableDomains: string[],
  sessionContext: string | null,
  memories: RetrievedMemory[],
  semanticMatches: string[]
): string {
  const memorySection =
    memories.length > 0
      ? `\n## Org Memories (learned from prior conversations)\n${memories.map((m) => `- ${m.content}`).join("\n")}\n`
      : "";

  const semanticSection =
    semanticMatches.length > 0
      ? `\n## Known Term Definitions\n${semanticMatches.join("\n")}\n`
      : "";

  const sessionSection = sessionContext
    ? `\n## Session Context (prior turns in this conversation)\n${sessionContext}\n`
    : "";

  return `You are a query planner for a data platform. Your job is to classify user questions and build a query plan.

## Available Data Domains
${availableDomains.map((d) => `- ${d}`).join("\n")}
${memorySection}${semanticSection}${sessionSection}

## Your Task

Analyze the user's question and return a JSON object with:

1. **turn_type**: Classify the question:
   - "new" — Fresh question, no dependency on prior context
   - "follow_up" — References prior results ("their", "those", "same", "them", "these customers")
   - "pivot" — Shifts to a new domain but carries entity context ("what campaigns did we send them?")
   - "refinement" — Modifies the previous query ("sort by date", "only last quarter", "add zip code")

2. **intent**: What the user wants in one sentence (e.g., "Find top 5 customers by total spend")

3. **domain**: Which domain to query. Use available domains above, or "all" if it spans multiple.

4. **ambiguous**: Set to true ONLY if:
   - The question uses a generic term (like "customers") that maps to multiple domains AND the user hasn't specified which
   - The question uses a business term with no clear definition in memories or known terms AND the answer would change the query significantly
   Do NOT set ambiguous for straightforward questions. Most questions are NOT ambiguous.

5. **candidate_domains**: If ambiguous, list the possible domains (e.g., ["ecommerce", "crm"])

6. **needs_clarification**: If ambiguous, write a SHORT, natural clarifying question. Be conversational, not robotic. Examples:
   - "You have B2C customers from Shopify and B2B contacts from HubSpot — want both or just one?"
   - "When you say 'top customers,' do you mean by total spend, order count, or something else?"
   Keep it under 2 sentences.

7. **tables_needed**: List of database tables likely needed (e.g., ["ecom_customers", "ecom_orders"])

8. **resolved_references**: If turn_type is follow_up/pivot, map references to values:
   - "their" → entity IDs from session
   - "those zip codes" → extracted zip values

9. **edit_instruction**: If turn_type is refinement or follow_up that modifies the query, describe the SQL edit needed (e.g., "add default_address->>'zip' to the SELECT columns")

10. **previous_sql**: If editing a previous query, include the SQL being edited

## Rules
- Be decisive. If the domain is clearly ecommerce or clearly CRM, don't ask — just set it.
- Only ask clarifying questions when the answer genuinely changes what query you'd write.
- If org memories define a term, USE that definition — don't ask again.
- For follow-ups, you MUST resolve references to concrete values from session context.
- Keep tables_needed accurate — list only tables that will appear in the FROM/JOIN.

Respond with ONLY a valid JSON object. No markdown, no explanation.`;
}

/* ── Main Planner Function ───────────────────────────── */

/**
 * Plan a query based on the user's question, session state, and org context.
 */
export async function planQuery(
  question: string,
  session: DataAgentSession,
  semanticLayer: SemanticLayer,
  schemaMap: SchemaMap,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<QueryPlan> {
  // 1. Gather context
  const availableDomains = getAvailableDomains(schemaMap);
  const sessionContext = buildSessionContext(session);
  const semanticMatches = findTermMatches(question, semanticLayer).map(
    (m) => `- "${m.term}" → ${m.description} (SQL: ${m.sql_condition})`
  );

  // 2. Retrieve org memories for term definitions
  let memories: RetrievedMemory[] = [];
  try {
    memories = await retrieveMemories(supabase, orgId, userId, question, {
      limit: 5,
      scopeTypes: ["org", "user"],
      minConfidence: 0.3,
    });
  } catch (err) {
    console.error("[planner] Memory retrieval failed:", err);
  }

  // 3. Extract presentation metadata (code-level, no LLM)
  const expected_count = extractExpectedCount(question);
  const presentation_hint = extractPresentationHint(question);

  // 4. Quick classification for simple cases (avoid LLM call)
  const quickPlan = tryQuickClassification(question, session, semanticLayer, schemaMap);
  if (quickPlan) {
    quickPlan.expected_count = expected_count;
    quickPlan.presentation_hint = presentation_hint;
    return quickPlan;
  }

  // 4. Full classification via Haiku
  const prompt = buildPlannerPrompt(
    availableDomains.map(String),
    sessionContext,
    memories,
    semanticMatches
  );

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system: prompt,
      messages: [
        {
          role: "user",
          content: question,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[planner] No JSON found in response:", text);
      return buildFallbackPlan(question, semanticLayer);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Build QueryPlan from parsed response
    const plan: QueryPlan = {
      turn_type: parsed.turn_type || "new",
      intent: parsed.intent || question,
      domain: parsed.domain || getDomainForQuestion(question, semanticLayer),
      ambiguous: parsed.ambiguous === true,
      candidate_domains: parsed.candidate_domains,
      tables_needed: parsed.tables_needed || [],
      resolved_references: parsed.resolved_references || {},
      edit_instruction: parsed.edit_instruction,
      previous_sql: parsed.previous_sql,
      needs_clarification: parsed.needs_clarification,
      expected_count,
      presentation_hint,
    };

    // Resolve references from session state if Haiku identified them
    if (
      (plan.turn_type === "follow_up" || plan.turn_type === "pivot") &&
      hasHistory(session)
    ) {
      resolveSessionReferences(plan, session, question);
    }

    // Inject previous SQL for refinements
    if (plan.turn_type === "refinement" && !plan.previous_sql) {
      const lastTurn = getLastTurn(session);
      if (lastTurn) {
        plan.previous_sql = lastTurn.sql;
      }
    }

    return plan;
  } catch (err) {
    console.error("[planner] Haiku classification failed:", err);
    return buildFallbackPlan(question, semanticLayer);
  }
}

/* ── Quick Classification ────────────────────────────── */

/**
 * Domain keyword patterns for fast regex-based classification.
 * Each entry maps a domain to keyword patterns that STRONGLY indicate it.
 * Only "strong" keywords are used — generic terms like "customer" are excluded
 * because they could match ecommerce OR CRM.
 */
const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  ecommerce: [
    /\b(?:ecom(?:merce)?|shopify|b2c)\b/i,
    /\b(?:order(?:s|ed)?)\b/i,
    /\b(?:total.?spend|total.?spent|spend(?:ing)?)\b/i,
    /\b(?:product(?:s)?)\b/i,
    /\b(?:purchase(?:s|d)?|bought)\b/i,
    /\b(?:cart|shipping|fulfillment|refund(?:s|ed)?)\b/i,
    /\b(?:aov|average.?order.?value)\b/i,
    /\b(?:revenue)\b/i,
  ],
  crm: [
    /\b(?:crm|hubspot|b2b)\b/i,
    /\b(?:deal(?:s)?)\b/i,
    /\b(?:pipeline)\b/i,
    /\b(?:contact(?:s)?)\b/i,
    /\b(?:compan(?:y|ies))\b/i,
    /\b(?:prospect(?:s)?|lead(?:s)?|opportunit(?:y|ies))\b/i,
  ],
  campaigns: [
    /\b(?:campaign(?:s)?)\b/i,
    /\b(?:email(?:s)?\s+(?:sent|send|opened|clicked|bounced))\b/i,
    /\b(?:open.?rate|click.?rate|bounce.?rate)\b/i,
    /\b(?:newsletter(?:s)?)\b/i,
  ],
  behavioral: [
    /\b(?:segment(?:s|ation)?)\b/i,
    /\b(?:lifecycle)\b/i,
    /\b(?:rfm)\b/i,
    /\b(?:churn(?:ed|ing)?|at.?risk)\b/i,
    /\b(?:engagement.?score)\b/i,
  ],
};

/**
 * Pronoun patterns that indicate a follow-up referencing prior results.
 */
const FOLLOW_UP_PRONOUNS = /\b(?:their|them|those|these|they|same|its|his|her)\b/i;

/**
 * Try to classify simple cases without an LLM call.
 * Returns null if the question needs full Haiku classification.
 *
 * Three fast paths:
 * 1. Refinements — "sort by date", "limit to 10" (session history required)
 * 2. Follow-ups — "what are their zip codes" (session history + pronouns)
 * 3. New single-domain — "top 5 ecommerce customers" (matches exactly one domain)
 */
function tryQuickClassification(
  question: string,
  session: DataAgentSession,
  semanticLayer: SemanticLayer,
  schemaMap?: SchemaMap
): QueryPlan | null {
  const lower = question.toLowerCase().trim();

  // ── Path 1: Refinements (session history required) ──
  const refinementPatterns = [
    /^sort\s+(by|it)\s+/i,
    /^order\s+by\s+/i,
    /^limit\s+to\s+/i,
    /^only\s+(show|the)\s+(first|last|top)\s+/i,
    /^show\s+(only|just)\s+/i,
    /^filter\s+(by|for|to)\s+/i,
    /^add\s+(a\s+)?column\s+/i,
    /^include\s+/i,
    /^exclude\s+/i,
    /^remove\s+/i,
    /^group\s+by\s+/i,
  ];

  if (hasHistory(session)) {
    for (const pattern of refinementPatterns) {
      if (pattern.test(lower)) {
        const lastTurn = getLastTurn(session);
        if (lastTurn) {
          console.log("[planner] Quick classify: refinement (skipping Haiku)");
          return {
            turn_type: "refinement",
            intent: question,
            domain: lastTurn.domain,
            ambiguous: false,
            tables_needed: lastTurn.tables,
            resolved_references: {},
            edit_instruction: question,
            previous_sql: lastTurn.sql,
          };
        }
      }
    }

    // ── Path 2: Follow-ups with pronouns (session history required) ──
    if (FOLLOW_UP_PRONOUNS.test(lower)) {
      const lastTurn = getLastTurn(session);
      if (lastTurn) {
        // Resolve references from session state
        const resolved: Record<string, unknown> = {};
        const resolvedValues = resolveReference(session, question);
        if (resolvedValues && resolvedValues.length > 0) {
          // Find which pronoun matched
          const pronounMatch = lower.match(FOLLOW_UP_PRONOUNS);
          if (pronounMatch) {
            resolved[pronounMatch[0]] = resolvedValues;
          }
        }
        // Always carry forward active entity IDs
        if (
          Object.keys(resolved).length === 0 &&
          session.active_entity_ids.length > 0
        ) {
          resolved["_active_entities"] = session.active_entity_ids;
        }

        // Determine if this is a pivot (different domain) or follow-up (same domain)
        const domainScores = scoreDomains(lower);
        const topDomain = getTopDomain(domainScores);
        const isPivot =
          topDomain !== null &&
          topDomain !== lastTurn.domain &&
          topDomain !== "all";

        // For pivots, figure out which tables from the new domain
        let tablesNeeded = lastTurn.tables;
        if (isPivot && topDomain && schemaMap) {
          const domainTables = getTablesForDomain(schemaMap, topDomain);
          tablesNeeded = domainTables.map((t) => t.name).slice(0, 3);
        }

        console.log(
          `[planner] Quick classify: ${isPivot ? "pivot" : "follow_up"} (skipping Haiku)`
        );
        return {
          turn_type: isPivot ? "pivot" : "follow_up",
          intent: question,
          domain: isPivot && topDomain ? topDomain : lastTurn.domain,
          ambiguous: false,
          tables_needed: tablesNeeded,
          resolved_references: resolved,
          edit_instruction: isPivot ? undefined : question,
          previous_sql: isPivot ? undefined : lastTurn.sql,
        };
      }
    }
  }

  // ── Path 3: New question with clear single domain (no session needed) ──
  const domainScores = scoreDomains(lower);
  const matchedDomains = Object.entries(domainScores).filter(
    ([, score]) => score > 0
  );

  if (matchedDomains.length === 1) {
    // Exactly one domain matched — no ambiguity possible
    const [domain] = matchedDomains[0];
    const domainConfig = semanticLayer.domains[domain];
    const tables = domainConfig ? domainConfig.tables.slice(0, 3) : [];

    console.log(
      `[planner] Quick classify: new/${domain} (skipping Haiku)`
    );
    return {
      turn_type: "new",
      intent: question,
      domain,
      ambiguous: false,
      tables_needed: tables,
      resolved_references: {},
    };
  }

  // Multiple domains matched or zero — need Haiku for disambiguation
  return null;
}

/**
 * Score how many domain keyword patterns match a question.
 * Returns { domain: matchCount } for domains with at least 1 match.
 */
function scoreDomains(lower: string): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    let count = 0;
    for (const pattern of patterns) {
      if (pattern.test(lower)) count++;
    }
    if (count > 0) scores[domain] = count;
  }
  return scores;
}

/**
 * Get the top-scoring domain, or null if ambiguous/none.
 */
function getTopDomain(scores: Record<string, number>): string | null {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0][0];
  // If top two are close (within 1 point), it's ambiguous
  if (sorted[0][1] - sorted[1][1] <= 1) return null;
  return sorted[0][0];
}

/* ── Reference Resolution ────────────────────────────── */

/**
 * Resolve coreferences in the question against session state.
 * Updates plan.resolved_references with concrete values.
 */
function resolveSessionReferences(
  plan: QueryPlan,
  session: DataAgentSession,
  question: string
): void {
  // Try to resolve common reference patterns
  const referencePatterns = [
    "their",
    "them",
    "those",
    "these",
    "same",
    "the same",
  ];

  for (const ref of referencePatterns) {
    if (question.toLowerCase().includes(ref)) {
      const resolved = resolveReference(session, question);
      if (resolved && resolved.length > 0) {
        plan.resolved_references[ref] = resolved;
        break; // One resolution per question
      }
    }
  }

  // If no references resolved but it's a follow_up, carry forward entity IDs
  if (
    Object.keys(plan.resolved_references).length === 0 &&
    session.active_entity_ids.length > 0
  ) {
    plan.resolved_references["_active_entities"] =
      session.active_entity_ids;
  }
}

/* ── Presentation & Count Extraction ─────────────────── */

/**
 * Extract expected row count from the question.
 * "top 5 customers" → 5, "first 10 orders" → 10
 * Returns undefined if no explicit count found.
 */
export function extractExpectedCount(question: string): number | undefined {
  const lower = question.toLowerCase();

  // "top N", "first N", "last N", "bottom N"
  const topMatch = lower.match(/\b(?:top|first|last|bottom|best|worst)\s+(\d+)\b/);
  if (topMatch) return parseInt(topMatch[1], 10);

  // "N customers/orders/deals/contacts"
  const nEntitiesMatch = lower.match(/\b(\d+)\s+(?:customers?|orders?|deals?|contacts?|companies?|products?|campaigns?|people|results?)\b/);
  if (nEntitiesMatch) return parseInt(nEntitiesMatch[1], 10);

  // "show me 5", "give me 10", "list 20"
  const showMatch = lower.match(/\b(?:show|give|list|find|get)\s+(?:me\s+)?(\d+)\b/);
  if (showMatch) return parseInt(showMatch[1], 10);

  return undefined;
}

/**
 * Detect presentation intent from the question.
 * Uses keyword matching — no LLM call.
 */
export function extractPresentationHint(question: string): PresentationHint {
  const lower = question.toLowerCase();

  // Explicit chart/visual keywords
  const chartKeywords = [
    "chart", "graph", "plot", "visuali", "visual",
    "bar chart", "pie chart", "line chart",
    "show me a chart", "compare visually",
  ];
  if (chartKeywords.some((k) => lower.includes(k))) return "chart";

  // Comparison keywords (imply chart when combined with multiple entities)
  const compareKeywords = [
    "compare", "comparison", "versus", " vs ", " vs.",
    "side by side", "side-by-side", "how do they compare",
    "relative to", "compared to",
  ];
  if (compareKeywords.some((k) => lower.includes(k))) return "chart";

  // Table keywords
  const tableKeywords = [
    "table", "spreadsheet", "grid", "list all", "show all",
    "breakdown", "break down", "itemize",
  ];
  if (tableKeywords.some((k) => lower.includes(k))) return "table";

  // Detail keywords (single entity deep dive)
  const detailKeywords = [
    "detail", "tell me about", "everything about",
    "profile", "deep dive", "drill into",
  ];
  if (detailKeywords.some((k) => lower.includes(k))) return "detail";

  return "auto";
}

/* ── Structured Clarification ─────────────────────────── */

/**
 * Build structured clarification when the question is ambiguous
 * or the decomposed plan has many sub-queries.
 *
 * Triggers:
 * - Domain ambiguity: plan.candidate_domains has 2+ entries
 * - Multi-part overload: decomposed plan has 3+ sub-queries AND
 *   question has no explicit priority ("mainly", "especially")
 *
 * Returns null if no clarification needed.
 */
export function buildStructuredClarification(
  question: string,
  plan: QueryPlan,
  semanticLayer: SemanticLayer,
  decomposed?: DecomposedPlan | null
): StructuredClarification | null {
  // ── Trigger 1: Domain ambiguity ──
  if (plan.ambiguous && plan.candidate_domains && plan.candidate_domains.length >= 2) {
    const options = plan.candidate_domains.map((domain) => {
      const config = semanticLayer.domains[domain];
      return {
        label: domain.charAt(0).toUpperCase() + domain.slice(1),
        value: domain,
        description: config?.description || `Data from the ${domain} domain`,
      };
    });

    // Add "all" option
    options.unshift({
      label: "All of the above",
      value: "all",
      description: "Search across all data domains",
    });

    return {
      question: plan.needs_clarification || "Which data area are you interested in?",
      options,
      allow_freeform: true,
      reason: "domain_ambiguous",
    };
  }

  // ── Trigger 2: Multi-part question with 3+ sub-queries ──
  if (decomposed && decomposed.sub_queries.length >= 3) {
    // Check if user already expressed priority
    const hasPriority = /\b(?:mainly|especially|primarily|focus on|most importantly|start with)\b/i.test(question);
    if (hasPriority) return null;

    const options = decomposed.sub_queries.map((sq) => ({
      label: sq.intent.slice(0, 50),
      value: sq.id,
      description: `Tables: ${sq.tables_needed.join(", ")}`,
    }));

    options.unshift({
      label: "All of the above",
      value: "all",
      description: "Get everything — may take a moment",
    });

    return {
      question: "This covers multiple data areas. Which should I focus on?",
      options,
      allow_freeform: true,
      reason: "multi_part",
    };
  }

  return null;
}

/* ── Fallback Plan ───────────────────────────────────── */

/**
 * Build a basic plan when Haiku fails.
 * Uses the semantic layer to guess the domain and tables.
 */
function buildFallbackPlan(
  question: string,
  semanticLayer: SemanticLayer
): QueryPlan {
  const domain = getDomainForQuestion(question, semanticLayer);
  const domainConfig = semanticLayer.domains[domain];

  return {
    turn_type: "new",
    intent: question,
    domain,
    ambiguous: false,
    tables_needed: domainConfig ? domainConfig.tables.slice(0, 3) : [],
    resolved_references: {},
    expected_count: extractExpectedCount(question),
    presentation_hint: extractPresentationHint(question),
  };
}
