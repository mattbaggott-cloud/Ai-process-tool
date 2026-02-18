/**
 * Event Emitter — creates immutable events in the event stream.
 * Fire-and-forget pattern matches existing llm-logger.ts approach.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventInput } from "./types";

/**
 * Insert an event into the events table.
 * Returns the event id on success, null on failure.
 */
export async function emitEvent(
  supabase: SupabaseClient,
  event: EventInput
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("events")
      .insert({
        org_id: event.org_id,
        event_type: event.event_type,
        event_category: event.event_category,
        actor_type: event.actor_type,
        actor_id: event.actor_id ?? null,
        entity_type: event.entity_type ?? null,
        entity_id: event.entity_id ?? null,
        graph_node_id: event.graph_node_id ?? null,
        payload: event.payload ?? {},
        session_id: event.session_id ?? null,
        tool_name: event.tool_name ?? null,
        parent_event_id: event.parent_event_id ?? null,
        metadata: event.metadata ?? {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("Event emit failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("Event emit error:", err);
    return null;
  }
}

/**
 * Fire-and-forget event emission.
 * Never blocks the caller. Errors are logged to console.
 */
export function emitEventInBackground(
  supabase: SupabaseClient,
  event: EventInput
): void {
  Promise.resolve()
    .then(() => emitEvent(supabase, event))
    .catch((err) => console.error("Background event emit failed:", err));
}

/**
 * Convenience: emit a data event for CRUD operations
 */
export function emitDataEvent(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    eventType: "data.created" | "data.updated" | "data.deleted";
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
    sessionId?: string;
    toolName?: string;
  }
): void {
  emitEventInBackground(supabase, {
    org_id: params.orgId,
    event_type: params.eventType,
    event_category: "data",
    actor_type: params.sessionId ? "ai" : "user",
    actor_id: params.userId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    payload: params.payload ?? {},
    session_id: params.sessionId ?? null,
    tool_name: params.toolName ?? null,
  });
}

/**
 * Convenience: emit an AI tool event
 */
export function emitToolEvent(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    toolName: string;
    success: boolean;
    entityType?: string;
    entityId?: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    sessionId?: string;
  }
): void {
  emitEventInBackground(supabase, {
    org_id: params.orgId,
    event_type: params.success ? "ai.tool.completed" : "ai.tool.failed",
    event_category: "ai",
    actor_type: "ai",
    actor_id: params.userId,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    tool_name: params.toolName,
    payload: {
      success: params.success,
      input_summary: params.input ? Object.keys(params.input) : [],
      output_message: params.output?.message ?? null,
    },
    session_id: params.sessionId ?? null,
  });
}
