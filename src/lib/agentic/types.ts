/**
 * Agentic Graph — TypeScript types for the knowledge web
 */

/* ── Graph Node ──────────────────────────────────────── */

export interface GraphNode {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string | null;
  label: string;
  sublabel: string | null;
  properties: Record<string, unknown>;
  embedding?: number[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/* ── Graph Edge ──────────────────────────────────────── */

export interface GraphEdge {
  id: string;
  org_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  weight: number;
  properties: Record<string, unknown>;
  valid_from: string;
  valid_until: string | null;
  source: string;
  confidence: number;
  created_at: string;
  created_by: string | null;
}

/* ── Event Stream ────────────────────────────────────── */

export type EventCategory = "data" | "ai" | "auth" | "workflow" | "system";

export type EventType =
  // Data events
  | "data.created"
  | "data.updated"
  | "data.deleted"
  // AI events
  | "ai.chat.started"
  | "ai.chat.completed"
  | "ai.tool.called"
  | "ai.tool.completed"
  | "ai.tool.failed"
  | "ai.memory.extracted"
  // Auth events
  | "auth.login"
  | "auth.invite.sent"
  | "auth.role.changed"
  // Workflow events
  | "workflow.started"
  | "workflow.step.completed"
  | "workflow.completed"
  // Action framework events
  | "action.executed"
  | "action.completed"
  | "action.failed"
  | "action.denied"
  | "action.approval_required"
  // System events
  | "connector.sync.started"
  | "connector.sync.completed";

export type ActorType = "user" | "ai" | "system" | "connector";

export interface AgenticEvent {
  id: string;
  org_id: string;
  event_type: EventType | string;
  event_category: EventCategory;
  actor_type: ActorType;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  graph_node_id: string | null;
  payload: Record<string, unknown>;
  session_id: string | null;
  tool_name: string | null;
  parent_event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Input for creating a new event (id and created_at are auto-generated) */
export interface EventInput {
  org_id: string;
  event_type: EventType | string;
  event_category: EventCategory;
  actor_type: ActorType;
  actor_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  graph_node_id?: string | null;
  payload?: Record<string, unknown>;
  session_id?: string | null;
  tool_name?: string | null;
  parent_event_id?: string | null;
  metadata?: Record<string, unknown>;
}

/* ── Graph Traversal Result ──────────────────────────── */

export interface TraversalNode {
  node_id: string;
  entity_type: string;
  entity_id: string | null;
  label: string;
  sublabel: string | null;
  depth: number;
  path: string[];
  relation_types: string[];
}

/* ── Entity-to-graph mapping ─────────────────────────── */

/** Maps source table names to how labels/sublabels are extracted */
export interface EntityMapping {
  entityType: string;
  labelField: string;
  sublabelField?: string;
  labelBuilder?: (record: Record<string, unknown>) => string;
  sublabelBuilder?: (record: Record<string, unknown>) => string | null;
}

/** Maps foreign key fields to graph edge types */
export interface EdgeMapping {
  foreignKey: string;
  targetEntityType: string;
  relationType: string;
}

/** Complete mapping for a source table */
export interface TableGraphMapping {
  entity: EntityMapping;
  edges: EdgeMapping[];
}

/* ── Entity & Relation Registry (from DB) ────────────── */

/** Row from entity_type_registry (returned by get_entity_registry RPC) */
export interface EntityTypeRegistryEntry {
  entity_type: string;
  display_name: string;
  display_name_plural: string;
  icon: string | null;
  source_tables: string[];
  label_template: string | null;
  description: string | null;
  workspace_types: string[];
  sort_order: number;
}

/** Row from relation_type_registry (returned by get_relation_registry RPC) */
export interface RelationTypeRegistryEntry {
  relation_type: string;
  display_name: string;
  from_entity_type: string;
  to_entity_type: string;
  description: string | null;
  cardinality: string;
  is_directed: boolean;
  workspace_types: string[];
  sort_order: number;
}

/** Cached registry labels for use in graph-query formatting */
export interface RegistryLabels {
  entityLabels: Record<string, string>;       // entity_type → display_name
  relationLabels: Record<string, string>;     // relation_type → display_name
  entityEntries: EntityTypeRegistryEntry[];   // full entries for richer context
  relationEntries: RelationTypeRegistryEntry[]; // full entries for richer context
}
