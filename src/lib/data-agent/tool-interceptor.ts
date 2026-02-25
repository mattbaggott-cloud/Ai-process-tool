/**
 * Tool Interceptor — deterministic routing layer for data tools
 *
 * Sits between the LLM's tool choice and execution.
 * When the LLM picks a legacy data-read tool, this interceptor
 * reroutes it to `analyze_data` automatically.
 *
 * WHY: LLM prompts are probabilistic. Code is deterministic.
 * Instead of prompt-steering the copilot to "prefer analyze_data",
 * we enforce it here. The LLM can pick whatever tool it wants —
 * if it's a data read, it goes through the Data Agent.
 *
 * DESIGN PRINCIPLES:
 * - No hardcoded question strings or per-tool logic
 * - Classification is by TOOL CATEGORY, not by name
 * - Legacy tools still work for backwards compat if analyze_data fails
 * - New tools added to the platform don't need changes here
 *   (only tools explicitly registered as "data_read" get intercepted)
 */

/* ── Tool Category Registry ────────────────────────────── */

/**
 * Tools classified by their primary purpose.
 * Only "data_read" tools get intercepted.
 *
 * To add a new tool: just add it to the right category.
 * To exempt a tool from interception: put it in a different category.
 */
const TOOL_CATEGORIES: Record<string, string> = {
  // Data reads — these get rerouted to analyze_data
  query_ecommerce: "data_read",
  search_crm: "data_read",
  search_order_line_items: "data_read",
  search_tool_results: "data_read",

  // Analytics — pre-built dashboards, keep as-is (charts/KPIs that analyze_data doesn't produce yet)
  query_ecommerce_analytics: "analytics",

  // Data Agent — never intercept itself
  analyze_data: "data_agent",

  // Write operations — never intercept
  create_segment: "data_write",
  discover_segments: "data_write",
  create_contact: "data_write",
  update_deal: "data_write",
  log_activity: "data_write",
  create_inline_table: "render",
  create_inline_chart: "render",
};

/* ── Input-to-Question Extractors ──────────────────────── */

/**
 * Extract a natural-language question from any tool's input params.
 * Each tool has different param shapes — this normalizes them all
 * into a question string that analyze_data can understand.
 *
 * Returns null if we can't extract a meaningful question
 * (which means: don't intercept, let the original tool run).
 */
function extractQuestion(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case "query_ecommerce": {
      const entityType = input.entity_type as string | undefined;
      const filters = input.filters as Record<string, unknown> | undefined;
      const sortBy = input.sort_by as string | undefined;
      const limit = input.limit as number | undefined;
      const searchQuery = input.search_query as string | undefined;

      const parts: string[] = [];
      if (searchQuery) {
        parts.push(searchQuery);
      } else {
        parts.push(`Show ${entityType || "data"}`);
      }
      if (filters && Object.keys(filters).length > 0) {
        parts.push(`where ${Object.entries(filters).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(" and ")}`);
      }
      if (sortBy) parts.push(`sorted by ${sortBy}`);
      if (limit) parts.push(`limit ${limit}`);
      return parts.join(" ");
    }

    case "search_crm": {
      const query = input.query as string | undefined;
      const entityType = input.entity_type as string | undefined;
      if (query) return `Search CRM ${entityType || "records"} for: ${query}`;
      return `Show CRM ${entityType || "data"}`;
    }

    case "search_order_line_items": {
      const searchTerms = input.search_terms as string[] | undefined;
      const customerId = input.customer_id as string | undefined;
      const parts: string[] = [];
      if (searchTerms?.length) {
        parts.push(`Find orders containing products: ${searchTerms.join(", ")}`);
      }
      if (customerId) {
        parts.push(`for customer ${customerId}`);
      }
      return parts.length > 0 ? parts.join(" ") : null;
    }

    case "search_tool_results": {
      const query = input.query as string | undefined;
      // search_tool_results is searching previous output — the user
      // is really asking a follow-up data question
      if (query) return query;
      return null;
    }

    default:
      return null;
  }
}

/* ── Main Interceptor ──────────────────────────────────── */

export interface InterceptResult {
  intercepted: boolean;
  /** If intercepted, the rerouted tool name */
  toolName: string;
  /** If intercepted, the transformed input */
  input: Record<string, unknown>;
  /** Original tool name (for logging) */
  originalTool: string;
}

/**
 * Check if a tool call should be rerouted to analyze_data.
 *
 * When userQuestion is provided (the user's original message),
 * it's used as the analyze_data question instead of reconstructing
 * from legacy tool params. This preserves "top 5", "compare", etc.
 *
 * Returns the original tool call unchanged if:
 * - Tool is not a data_read
 * - Can't extract a meaningful question from the input
 * - Tool is already analyze_data
 *
 * Returns a rerouted call to analyze_data if:
 * - Tool is classified as data_read
 * - We have a user question or can extract one from input
 */
export function interceptToolCall(
  toolName: string,
  input: Record<string, unknown>,
  userQuestion?: string,
  bypassInterception?: boolean
): InterceptResult {
  // If analyze_data already failed this round, let legacy tools run directly
  // Prevents infinite loops: intercept → fail → Claude retries → intercept → fail
  if (bypassInterception) {
    return { intercepted: false, toolName, input, originalTool: toolName };
  }

  const category = TOOL_CATEGORIES[toolName];

  // Only intercept data_read tools
  if (category !== "data_read") {
    return {
      intercepted: false,
      toolName,
      input,
      originalTool: toolName,
    };
  }

  // Prefer the user's original question — it preserves intent,
  // count ("top 5"), and presentation hints ("visual comparison")
  // that get lost when reconstructing from legacy tool params
  const question = userQuestion?.trim() || extractQuestion(toolName, input);
  if (!question) {
    // Can't form a question — let the original tool handle it
    return {
      intercepted: false,
      toolName,
      input,
      originalTool: toolName,
    };
  }

  // Reroute to analyze_data
  console.log(`[interceptor] Rerouting ${toolName} → analyze_data: "${question}"`);
  return {
    intercepted: true,
    toolName: "analyze_data",
    input: { question },
    originalTool: toolName,
  };
}
