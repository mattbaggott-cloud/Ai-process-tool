/**
 * Graph Query — hybrid entity resolution + graph traversal.
 *
 * Powers the Knowledge Graph intelligence layer. When a user asks about entities,
 * this module finds the relevant graph nodes and traverses the graph
 * to surface connected context (people, companies, pipeline items, orders, etc.)
 *
 * Phase 4 changes:
 *   - Uses registry-driven display names via loadRegistryLabels()
 *   - Falls back to hardcoded labels if registry unavailable
 *   - Supports unified entity types (person, company, pipeline_item, etc.)
 *   - Preserves backwards compat with legacy entity types (crm_contacts, etc.)
 *
 * Flow:
 *   1. Load registry labels for the org (cached, 5-min TTL)
 *   2. Extract entity mentions from the user's message
 *   3. Resolve mentions to graph nodes (label matching + fuzzy search)
 *   4. Traverse the graph from matched nodes (2-hop)
 *   5. Format connected entities into a prompt section using registry display names
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistryLabels } from "./types";
import { loadRegistryLabels } from "./graph-sync";

/* ── Types ── */

interface GraphNodeResult {
  node_id: string;
  entity_type: string;
  entity_id: string | null;
  label: string;
  sublabel: string | null;
  depth: number;
  path: string[];
  relation_types: string[];
}

interface ResolvedEntity {
  nodeId: string;
  entityType: string;
  entityId: string | null;
  label: string;
  sublabel: string | null;
  matchedOn: string; // what search term matched
}

interface GraphContext {
  resolvedEntities: ResolvedEntity[];
  connectedNodes: GraphNodeResult[];
  formatted: string; // ready for system prompt injection
}

/* ── Main Entry Point ── */

/**
 * Get graph context for a user message.
 * Finds mentioned entities, traverses the graph, returns formatted context.
 */
export async function getGraphContext(
  supabase: SupabaseClient,
  orgId: string,
  message: string
): Promise<GraphContext> {
  const empty: GraphContext = { resolvedEntities: [], connectedNodes: [], formatted: "" };

  try {
    // Step 0: Load registry labels (cached)
    const registry = await loadRegistryLabels(supabase, orgId);

    // Step 1: Extract potential entity mentions from the message
    const searchTerms = extractSearchTerms(message);
    if (searchTerms.length === 0) return empty;

    // Step 2: Resolve search terms to graph nodes
    const resolved = await resolveEntities(supabase, orgId, searchTerms);
    if (resolved.length === 0) return empty;

    // Step 3: Traverse graph from each resolved node (2-hop)
    const allConnected: GraphNodeResult[] = [];
    const seenNodeIds = new Set<string>();

    for (const entity of resolved) {
      seenNodeIds.add(entity.nodeId);
      const { data: traversed } = await supabase.rpc("graph_traverse", {
        start_node_id: entity.nodeId,
        max_depth: 2,
        relation_filter: null,
        direction: "both",
      });

      if (traversed) {
        for (const node of traversed as GraphNodeResult[]) {
          if (!seenNodeIds.has(node.node_id) && node.depth > 0) {
            seenNodeIds.add(node.node_id);
            allConnected.push(node);
          }
        }
      }
    }

    // Step 4: Format into prompt section using registry labels
    const formatted = formatGraphContext(resolved, allConnected, registry);

    return {
      resolvedEntities: resolved,
      connectedNodes: allConnected,
      formatted,
    };
  } catch (err) {
    console.error("[GraphQuery] Failed:", err);
    return empty;
  }
}

/* ── Entity Resolution ── */

/**
 * Extract potential entity names from a user message.
 * Uses heuristics: capitalized words, quoted strings, and known patterns.
 */
function extractSearchTerms(message: string): string[] {
  const terms: string[] = [];

  // 1. Quoted strings — "Acme Corp", 'John Smith'
  const quoted = message.match(/["']([^"']+)["']/g);
  if (quoted) {
    for (const q of quoted) {
      terms.push(q.replace(/["']/g, ""));
    }
  }

  // 2. Capitalized multi-word phrases (proper nouns) — "Acme Corp", "John Smith"
  //    But not at the start of a sentence and not common words
  const COMMON_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "will", "can", "could",
    "should", "would", "do", "does", "did", "have", "has", "had", "i", "we",
    "you", "they", "he", "she", "it", "my", "our", "your", "their", "his",
    "her", "its", "what", "which", "who", "whom", "where", "when", "why",
    "how", "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "no", "not", "only", "same", "than", "too", "very",
    "just", "about", "above", "after", "again", "also", "back", "been",
    "before", "between", "come", "could", "day", "even", "first", "get",
    "give", "go", "good", "great", "here", "high", "just", "know", "last",
    "let", "like", "long", "look", "make", "many", "may", "me", "much",
    "new", "now", "old", "one", "over", "own", "part", "say", "see",
    "show", "tell", "think", "time", "two", "use", "want", "way", "well",
    "work", "year", "also", "into", "but", "for", "from", "with", "this",
    "that", "those", "these", "then", "there", "here", "still", "create",
    "update", "delete", "find", "search", "list", "add", "remove", "set",
    "change", "move", "deal", "deals", "contact", "contacts", "company",
    "companies", "goal", "goals", "team", "teams", "report", "active",
    "lead", "leads", "pipeline", "stage", "status", "value", "everything",
    "anything", "something", "nothing", "everyone", "anyone",
  ]);

  // Find sequences of capitalized words (2+ words)
  const capPattern = /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)+)\b/g;
  let match;
  while ((match = capPattern.exec(message)) !== null) {
    const phrase = match[1];
    // Skip if all words are common
    const words = phrase.split(/\s+/);
    const hasProperNoun = words.some(w => !COMMON_WORDS.has(w.toLowerCase()));
    if (hasProperNoun && phrase.length >= 3) {
      terms.push(phrase);
    }
  }

  // 3. Single capitalized words that aren't at the start of a sentence
  //    and aren't common words (catches "Acme", "HubSpot")
  const singleCap = /(?<=[.!?\s])\s*([A-Z][a-zA-Z]{2,})\b/g;
  while ((match = singleCap.exec(message)) !== null) {
    const word = match[1];
    if (!COMMON_WORDS.has(word.toLowerCase()) && word.length >= 3) {
      // Only add if not already part of a multi-word term
      const alreadyCovered = terms.some(t => t.includes(word));
      if (!alreadyCovered) {
        terms.push(word);
      }
    }
  }

  // 4. "about X" / "regarding X" / "related to X" patterns
  const aboutPattern = /(?:about|regarding|related to|everything about|tell me about)\s+(.+?)(?:\?|$|\.|\band\b)/gi;
  while ((match = aboutPattern.exec(message)) !== null) {
    const subject = match[1].trim();
    if (subject.length >= 2 && subject.length <= 60) {
      terms.push(subject);
    }
  }

  // Deduplicate and return
  const unique = [...new Set(terms.map(t => t.trim()).filter(t => t.length >= 2))];
  return unique.slice(0, 5); // Cap at 5 to avoid excessive queries
}

/**
 * Resolve search terms to graph nodes using label matching.
 * Uses ILIKE for fuzzy matching.
 */
async function resolveEntities(
  supabase: SupabaseClient,
  orgId: string,
  searchTerms: string[]
): Promise<ResolvedEntity[]> {
  const resolved: ResolvedEntity[] = [];
  const seenIds = new Set<string>();

  for (const term of searchTerms) {
    try {
      // Exact label match first
      const { data: exactMatches } = await supabase
        .from("graph_nodes")
        .select("id, entity_type, entity_id, label, sublabel")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .ilike("label", term)
        .limit(3);

      if (exactMatches && exactMatches.length > 0) {
        for (const node of exactMatches) {
          if (!seenIds.has(node.id)) {
            seenIds.add(node.id);
            resolved.push({
              nodeId: node.id,
              entityType: node.entity_type,
              entityId: node.entity_id,
              label: node.label,
              sublabel: node.sublabel,
              matchedOn: term,
            });
          }
        }
        continue; // Got exact matches, skip fuzzy
      }

      // Fuzzy match: ILIKE with wildcards
      const { data: fuzzyMatches } = await supabase
        .from("graph_nodes")
        .select("id, entity_type, entity_id, label, sublabel")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .ilike("label", `%${term}%`)
        .limit(5);

      if (fuzzyMatches) {
        for (const node of fuzzyMatches) {
          if (!seenIds.has(node.id)) {
            seenIds.add(node.id);
            resolved.push({
              nodeId: node.id,
              entityType: node.entity_type,
              entityId: node.entity_id,
              label: node.label,
              sublabel: node.sublabel,
              matchedOn: term,
            });
          }
        }
      }
    } catch (err) {
      console.error(`[GraphQuery] Resolve failed for "${term}":`, err);
    }
  }

  return resolved.slice(0, 10); // Cap total results
}

/* ── Formatting ── */

/**
 * Format graph context for injection into the system prompt.
 * Uses registry labels for display names (falls back to raw entity_type).
 */
function formatGraphContext(
  resolved: ResolvedEntity[],
  connected: GraphNodeResult[],
  registry: RegistryLabels
): string {
  if (resolved.length === 0) return "";

  const { entityLabels, relationLabels } = registry;

  let output = "## Related Entities (Knowledge Graph)\n";
  output += "The following entities and their connections were found in the knowledge graph. Use this to provide richer, cross-entity context.\n\n";

  // Group connected nodes by which resolved entity they came from
  for (const entity of resolved) {
    const typeLabel = entityLabels[entity.entityType] ?? entity.entityType;
    output += `### ${typeLabel}: ${entity.label}`;
    if (entity.sublabel) output += ` — ${entity.sublabel}`;
    output += "\n";

    // Find directly connected nodes (depth 1)
    const directConnections = connected.filter(
      n => n.depth === 1 && n.path.includes(entity.nodeId)
    );

    // Find 2-hop connections
    const secondHop = connected.filter(
      n => n.depth === 2 && n.path.includes(entity.nodeId)
    );

    if (directConnections.length > 0) {
      output += "**Direct connections:**\n";
      for (const conn of directConnections) {
        const connTypeLabel = entityLabels[conn.entity_type] ?? conn.entity_type;
        const relationLabel = conn.relation_types.length > 0
          ? conn.relation_types.map(r => relationLabels[r] ?? r).join(", ")
          : "connected to";
        output += `- [${connTypeLabel}] **${conn.label}**`;
        if (conn.sublabel) output += ` (${conn.sublabel})`;
        output += ` — ${relationLabel}\n`;
      }
    }

    if (secondHop.length > 0) {
      output += "**Extended network:**\n";
      for (const conn of secondHop.slice(0, 10)) { // Cap at 10 to avoid prompt bloat
        const connTypeLabel = entityLabels[conn.entity_type] ?? conn.entity_type;
        output += `- [${connTypeLabel}] ${conn.label}`;
        if (conn.sublabel) output += ` (${conn.sublabel})`;
        const relations = conn.relation_types.map(r => relationLabels[r] ?? r).join(" → ");
        if (relations) output += ` via ${relations}`;
        output += "\n";
      }
    }

    if (directConnections.length === 0 && secondHop.length === 0) {
      output += "*No connected entities found in the graph.*\n";
    }

    output += "\n";
  }

  return output;
}
