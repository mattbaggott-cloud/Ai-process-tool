/**
 * Graph Sync — creates and updates graph nodes and edges
 * when data is created/updated via tool-executor or UI.
 *
 * Key principle: graph nodes are lightweight pointers to existing records.
 * The actual data lives in the source table (crm_contacts, goals, etc).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TableGraphMapping, EdgeMapping } from "./types";

/* ── Table-to-graph mappings ─────────────────────────── */

/**
 * Defines how each source table maps to graph nodes and edges.
 * When a record is created/updated, the graph-sync uses these
 * mappings to ensure nodes and edges exist.
 */
const TABLE_MAPPINGS: Record<string, TableGraphMapping> = {
  crm_contacts: {
    entity: {
      entityType: "crm_contacts",
      labelField: "first_name",
      labelBuilder: (r) => {
        const first = (r.first_name as string) || "";
        const last = (r.last_name as string) || "";
        return `${first} ${last}`.trim() || (r.email as string) || "Unknown Contact";
      },
      sublabelBuilder: (r) => (r.title as string) || (r.status as string) || null,
    },
    edges: [
      { foreignKey: "company_id", targetEntityType: "crm_companies", relationType: "works_at" },
    ],
  },
  crm_companies: {
    entity: {
      entityType: "crm_companies",
      labelField: "name",
      sublabelBuilder: (r) => (r.industry as string) || (r.domain as string) || null,
    },
    edges: [],
  },
  crm_deals: {
    entity: {
      entityType: "crm_deals",
      labelField: "title",
      sublabelBuilder: (r) => {
        const stage = (r.stage as string) || "";
        const value = r.value ? `$${r.value}` : "";
        return [stage, value].filter(Boolean).join(" — ") || null;
      },
    },
    edges: [
      { foreignKey: "contact_id", targetEntityType: "crm_contacts", relationType: "primary_contact" },
      { foreignKey: "company_id", targetEntityType: "crm_companies", relationType: "for_company" },
    ],
  },
  crm_activities: {
    entity: {
      entityType: "crm_activities",
      labelField: "subject",
      labelBuilder: (r) => (r.subject as string) || (r.type as string) || "Activity",
      sublabelBuilder: (r) => (r.type as string) || null,
    },
    edges: [
      { foreignKey: "contact_id", targetEntityType: "crm_contacts", relationType: "regarding_contact" },
      { foreignKey: "company_id", targetEntityType: "crm_companies", relationType: "regarding_company" },
      { foreignKey: "deal_id", targetEntityType: "crm_deals", relationType: "regarding_deal" },
    ],
  },
  goals: {
    entity: {
      entityType: "goals",
      labelField: "name",
      sublabelBuilder: (r) => (r.status as string) || null,
    },
    edges: [],
  },
  sub_goals: {
    entity: {
      entityType: "sub_goals",
      labelField: "name",
      sublabelBuilder: (r) => (r.status as string) || null,
    },
    edges: [
      { foreignKey: "goal_id", targetEntityType: "goals", relationType: "child_of" },
    ],
  },
  pain_points: {
    entity: {
      entityType: "pain_points",
      labelField: "name",
      sublabelBuilder: (r) => {
        const severity = (r.severity as string) || "";
        const status = (r.status as string) || "";
        return [severity, status].filter(Boolean).join(" — ") || null;
      },
    },
    edges: [
      { foreignKey: "linked_goal_id", targetEntityType: "goals", relationType: "linked_to" },
    ],
  },
  teams: {
    entity: {
      entityType: "teams",
      labelField: "name",
      sublabelBuilder: (r) => (r.description as string) || null,
    },
    edges: [],
  },
  projects: {
    entity: {
      entityType: "projects",
      labelField: "name",
      sublabelBuilder: (r) => (r.active_mode as string) || null,
    },
    edges: [],
  },
  library_items: {
    entity: {
      entityType: "library_items",
      labelField: "title",
      sublabelBuilder: (r) => (r.category as string) || null,
    },
    edges: [],
  },

  /* ── E-Commerce entities ── */
  ecom_customers: {
    entity: {
      entityType: "ecom_customers",
      labelField: "email",
      labelBuilder: (r) => {
        const first = (r.first_name as string) || "";
        const last = (r.last_name as string) || "";
        const name = `${first} ${last}`.trim();
        return name || (r.email as string) || "Unknown Customer";
      },
      sublabelBuilder: (r) => {
        const spent = r.total_spent ? `$${r.total_spent}` : "";
        const orders = r.orders_count ? `${r.orders_count} orders` : "";
        return [spent, orders].filter(Boolean).join(" · ") || null;
      },
    },
    edges: [],
  },
  ecom_orders: {
    entity: {
      entityType: "ecom_orders",
      labelField: "order_number",
      labelBuilder: (r) => (r.order_number as string) || `Order ${(r.external_id as string) || ""}`,
      sublabelBuilder: (r) => {
        const price = r.total_price ? `$${r.total_price}` : "";
        const status = (r.financial_status as string) || "";
        return [price, status].filter(Boolean).join(" · ") || null;
      },
    },
    edges: [
      { foreignKey: "customer_id", targetEntityType: "ecom_customers", relationType: "placed_by" },
    ],
  },
  ecom_products: {
    entity: {
      entityType: "ecom_products",
      labelField: "title",
      sublabelBuilder: (r) => {
        const type = (r.product_type as string) || "";
        const vendor = (r.vendor as string) || "";
        return [type, vendor].filter(Boolean).join(" · ") || null;
      },
    },
    edges: [],
  },
};

/* ── Core sync functions ─────────────────────────────── */

/**
 * Ensure a graph node exists for a given entity.
 * Creates if missing, updates label/sublabel if changed.
 * Returns the node id.
 */
export async function ensureGraphNode(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  label: string,
  sublabel?: string | null,
  createdBy?: string | null
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("graph_nodes")
      .upsert(
        {
          org_id: orgId,
          entity_type: entityType,
          entity_id: entityId,
          label,
          sublabel: sublabel ?? null,
          created_by: createdBy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,entity_type,entity_id" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("Graph node upsert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("Graph node error:", err);
    return null;
  }
}

/**
 * Create a graph edge between two nodes.
 * Only creates if source and target nodes exist.
 */
async function createEdge(
  supabase: SupabaseClient,
  orgId: string,
  sourceNodeId: string,
  targetNodeId: string,
  relationType: string
): Promise<void> {
  try {
    await supabase.from("graph_edges").upsert(
      {
        org_id: orgId,
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        relation_type: relationType,
        valid_from: new Date().toISOString(),
      },
      { onConflict: "org_id,source_node_id,target_node_id,relation_type,valid_from", ignoreDuplicates: true }
    );
  } catch (err) {
    console.error("Graph edge create failed:", err);
  }
}

/**
 * Sync edges for a record based on its foreign key mappings.
 */
async function syncEdges(
  supabase: SupabaseClient,
  orgId: string,
  sourceNodeId: string,
  record: Record<string, unknown>,
  edgeMappings: EdgeMapping[]
): Promise<void> {
  for (const mapping of edgeMappings) {
    const fkValue = record[mapping.foreignKey] as string | undefined;
    if (!fkValue) continue;

    // Find the target graph node by entity_type + entity_id
    const { data: targetNode } = await supabase
      .from("graph_nodes")
      .select("id")
      .eq("org_id", orgId)
      .eq("entity_type", mapping.targetEntityType)
      .eq("entity_id", fkValue)
      .single();

    if (targetNode?.id) {
      await createEdge(supabase, orgId, sourceNodeId, targetNode.id, mapping.relationType);
    }
  }
}

/**
 * Full graph sync for a record: ensure node exists + sync all edges.
 * Call this after any CRUD operation.
 */
export async function syncRecordToGraph(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  record: Record<string, unknown>,
  userId?: string
): Promise<string | null> {
  const mapping = TABLE_MAPPINGS[entityType];
  if (!mapping) return null;

  // Build label
  const label = mapping.entity.labelBuilder
    ? mapping.entity.labelBuilder(record)
    : (record[mapping.entity.labelField] as string) || "Unknown";

  // Build sublabel
  const sublabel = mapping.entity.sublabelBuilder
    ? mapping.entity.sublabelBuilder(record)
    : mapping.entity.sublabelField
    ? (record[mapping.entity.sublabelField] as string) || null
    : null;

  // Ensure node
  const nodeId = await ensureGraphNode(
    supabase,
    orgId,
    entityType,
    entityId,
    label,
    sublabel,
    userId
  );

  if (!nodeId) return null;

  // Sync edges
  if (mapping.edges.length > 0) {
    await syncEdges(supabase, orgId, nodeId, record, mapping.edges);
  }

  return nodeId;
}

/**
 * Fire-and-forget graph sync — never blocks the caller.
 */
export function syncRecordToGraphInBackground(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  record: Record<string, unknown>,
  userId?: string
): void {
  Promise.resolve()
    .then(() => syncRecordToGraph(supabase, orgId, entityType, entityId, record, userId))
    .catch((err) => console.error("Background graph sync failed:", err));
}

/**
 * Invalidate an edge (set valid_until instead of deleting).
 */
export async function invalidateEdge(
  supabase: SupabaseClient,
  edgeId: string
): Promise<void> {
  try {
    await supabase
      .from("graph_edges")
      .update({ valid_until: new Date().toISOString() })
      .eq("id", edgeId);
  } catch (err) {
    console.error("Edge invalidation failed:", err);
  }
}

/**
 * Deactivate a graph node (soft delete).
 */
export async function deactivateNode(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  try {
    await supabase
      .from("graph_nodes")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
  } catch (err) {
    console.error("Node deactivation failed:", err);
  }
}

/**
 * Get the supported entity types for graph sync
 */
export function getSupportedEntityTypes(): string[] {
  return Object.keys(TABLE_MAPPINGS);
}
