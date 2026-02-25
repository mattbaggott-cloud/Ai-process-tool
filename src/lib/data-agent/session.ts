/**
 * Session State — multi-turn conversation tracking for the Data Agent
 *
 * In-memory store that tracks:
 * - Active entity IDs from query results (for "their", "those", "them")
 * - Extracted result values (for "those zip codes", "those amounts")
 * - Domain context (for cross-domain pivots)
 * - Previous queries (for CoE-SQL editing)
 *
 * Sessions expire after 30 minutes of inactivity.
 */

import type { DataAgentSession, QueryTurn } from "./types";

/* ── Constants ───────────────────────────────────────── */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean up every 5 minutes
const MAX_QUERY_HISTORY = 20; // Keep last 20 turns per session

/* ── In-memory Store ─────────────────────────────────── */

const sessions = new Map<string, DataAgentSession>();

// Periodic cleanup of expired sessions
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
      if (now - session.last_activity > SESSION_TTL_MS) {
        sessions.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if interval is running
  if (cleanupInterval && typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref();
  }
}

/* ── Public API ──────────────────────────────────────── */

/**
 * Get or create a session for the given session + org combination.
 */
export function getSession(
  sessionId: string,
  orgId: string
): DataAgentSession {
  startCleanup();

  const key = `${orgId}:${sessionId}`;
  const existing = sessions.get(key);

  if (existing && Date.now() - existing.last_activity < SESSION_TTL_MS) {
    existing.last_activity = Date.now();
    return existing;
  }

  // Create new session
  const session: DataAgentSession = {
    session_id: sessionId,
    org_id: orgId,
    current_domain: null,
    active_entity_type: null,
    active_entity_ids: [],
    accumulated_filters: {},
    queries: [],
    last_activity: Date.now(),
  };

  sessions.set(key, session);
  return session;
}

/**
 * Update session state after a successful query.
 */
export function updateSession(
  session: DataAgentSession,
  turn: QueryTurn
): void {
  session.queries.push(turn);

  // Trim to last N turns
  if (session.queries.length > MAX_QUERY_HISTORY) {
    session.queries = session.queries.slice(-MAX_QUERY_HISTORY);
  }

  // Update active context
  session.current_domain = turn.domain;
  session.active_entity_ids = turn.entity_ids;
  session.last_activity = Date.now();

  // Infer active entity type from the primary table
  if (turn.tables.length > 0) {
    session.active_entity_type = turn.tables[0];
  }
}

/**
 * Resolve a reference like "their", "those", "them", "same customers"
 * to concrete values from the session.
 *
 * Returns the resolved values, or null if the reference can't be resolved.
 */
export function resolveReference(
  session: DataAgentSession,
  reference: string
): unknown[] | null {
  if (session.queries.length === 0) return null;

  const lastTurn = session.queries[session.queries.length - 1];
  const lowerRef = reference.toLowerCase();

  // Pronoun references → active entity IDs
  if (
    lowerRef.includes("their") ||
    lowerRef.includes("them") ||
    lowerRef.includes("those") ||
    lowerRef.includes("these") ||
    lowerRef.includes("same")
  ) {
    // Check if the reference is about specific result values
    // e.g., "those zip codes" → result_values.zip
    for (const [key, values] of Object.entries(lastTurn.result_values)) {
      if (lowerRef.includes(key.toLowerCase()) && values.length > 0) {
        return values;
      }
    }

    // Default: return active entity IDs
    if (session.active_entity_ids.length > 0) {
      return session.active_entity_ids;
    }
  }

  return null;
}

/**
 * Get the last query turn from the session.
 */
export function getLastTurn(
  session: DataAgentSession
): QueryTurn | null {
  if (session.queries.length === 0) return null;
  return session.queries[session.queries.length - 1];
}

/**
 * Check if the session has any prior queries.
 */
export function hasHistory(session: DataAgentSession): boolean {
  return session.queries.length > 0;
}

/**
 * Build a session context summary for the Planner/Generator.
 * Returns a compact string describing what happened in prior turns.
 */
export function buildSessionContext(session: DataAgentSession): string | null {
  if (session.queries.length === 0) return null;

  const parts: string[] = [];
  parts.push(`Session has ${session.queries.length} prior query turn(s).`);

  if (session.current_domain) {
    parts.push(`Current domain: ${session.current_domain}`);
  }

  if (session.active_entity_ids.length > 0) {
    parts.push(
      `Active entity IDs (${session.active_entity_ids.length}): ${session.active_entity_ids.slice(0, 5).join(", ")}${session.active_entity_ids.length > 5 ? "..." : ""}`
    );
  }

  // Last 3 turns summary
  const recent = session.queries.slice(-3);
  for (let i = 0; i < recent.length; i++) {
    const turn = recent[i];
    parts.push(
      `Turn ${session.queries.length - recent.length + i + 1}: "${turn.question}" → ${turn.tables.join(", ")} (${turn.domain})`
    );
    if (turn.result_summary) {
      parts.push(`  Result: ${turn.result_summary}`);
    }
    // Show extracted values that could be referenced
    const valKeys = Object.keys(turn.result_values).filter(
      (k) => (turn.result_values[k] as unknown[]).length > 0
    );
    if (valKeys.length > 0) {
      parts.push(
        `  Extractable values: ${valKeys.map((k) => `${k} (${(turn.result_values[k] as unknown[]).length} values)`).join(", ")}`
      );
    }
  }

  return parts.join("\n");
}
