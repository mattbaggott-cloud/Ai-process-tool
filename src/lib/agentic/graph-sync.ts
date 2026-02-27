/**
 * Graph Sync — creates and updates graph nodes and edges
 * when data is created/updated via tool-executor or UI.
 *
 * Key principle: graph nodes are lightweight pointers to existing records.
 * The actual data lives in the source table (crm_contacts, goals, etc).
 *
 * Phase 4 changes:
 *   - SOURCE_TABLE_TO_ENTITY_TYPE maps table names → unified graph types
 *     (ecom_customers → person, crm_deals → pipeline_item, etc.)
 *   - TABLE_MAPPINGS still handles label building (JS closures can't live in DB)
 *   - syncRecordToGraph uses unified entity type for graph nodes
 *   - Edge target lookups search both unified and legacy entity types
 *   - loadRegistryLabels() loads display names from DB for the query layer
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TableGraphMapping,
  EdgeMapping,
  RegistryLabels,
  EntityTypeRegistryEntry,
  RelationTypeRegistryEntry,
} from "./types";

/* ── Source table → Unified entity type mapping ───────── */

/**
 * Maps source table names to their unified graph entity type.
 * This is the core abstraction: the graph uses unified types (person, company, etc.)
 * while the source tables keep their original names.
 *
 * Matches the entity_type_registry.source_tables in migration 032.
 */
const SOURCE_TABLE_TO_ENTITY_TYPE: Record<string, string> = {
  // People (3 source tables → 1 unified type)
  ecom_customers: "person",
  crm_contacts: "person",
  klaviyo_profiles: "person",
  // Companies
  crm_companies: "company",
  // Pipeline (was "deals")
  crm_deals: "pipeline_item",
  // Activities
  crm_activities: "activity",
  // Orders
  ecom_orders: "order",
  // Products
  ecom_products: "product",
  // Campaigns
  email_campaigns: "campaign",
  klaviyo_campaigns: "campaign",
  // Segments
  segments: "segment",
  // Documents
  library_files: "document",
  library_items: "document",
  // Goals & planning
  goals: "goal",
  sub_goals: "sub_goal",
  pain_points: "pain_point",
  // Teams & projects
  teams: "team",
  projects: "project",
  // Lists
  klaviyo_lists: "list",
};

/**
 * Resolve a source table name to its unified entity type.
 * Falls back to the source table name if no mapping exists.
 */
export function resolveEntityType(sourceTable: string): string {
  return SOURCE_TABLE_TO_ENTITY_TYPE[sourceTable] ?? sourceTable;
}

/* ── Table-to-graph mappings (label building) ─────────── */

/**
 * Defines how each source table builds labels and sublabels for graph nodes.
 * Also defines edge foreign key relationships.
 *
 * NOTE: Edge targetEntityType values use UNIFIED types (person, company, etc.)
 * so that edges correctly link to nodes stored with unified entity types.
 */
const TABLE_MAPPINGS: Record<string, TableGraphMapping> = {
  crm_contacts: {
    entity: {
      entityType: "person", // unified
      labelField: "first_name",
      labelBuilder: (r) => {
        const first = (r.first_name as string) || "";
        const last = (r.last_name as string) || "";
        return `${first} ${last}`.trim() || (r.email as string) || "Unknown Contact";
      },
      sublabelBuilder: (r) => (r.title as string) || (r.status as string) || null,
    },
    edges: [
      { foreignKey: "company_id", targetEntityType: "company", relationType: "works_at" },
    ],
  },
  crm_companies: {
    entity: {
      entityType: "company", // unified
      labelField: "name",
      sublabelBuilder: (r) => (r.industry as string) || (r.domain as string) || null,
    },
    edges: [],
  },
  crm_deals: {
    entity: {
      entityType: "pipeline_item", // unified (was "deal")
      labelField: "title",
      sublabelBuilder: (r) => {
        const stage = (r.stage as string) || "";
        const value = r.value ? `$${r.value}` : "";
        return [stage, value].filter(Boolean).join(" — ") || null;
      },
    },
    edges: [
      { foreignKey: "contact_id", targetEntityType: "person", relationType: "primary_contact" },
      { foreignKey: "company_id", targetEntityType: "company", relationType: "for_company" },
    ],
  },
  crm_activities: {
    entity: {
      entityType: "activity", // unified
      labelField: "subject",
      labelBuilder: (r) => (r.subject as string) || (r.type as string) || "Activity",
      sublabelBuilder: (r) => (r.type as string) || null,
    },
    edges: [
      { foreignKey: "contact_id", targetEntityType: "person", relationType: "regarding_contact" },
      { foreignKey: "company_id", targetEntityType: "company", relationType: "regarding_company" },
      { foreignKey: "deal_id", targetEntityType: "pipeline_item", relationType: "regarding_deal" },
    ],
  },
  goals: {
    entity: {
      entityType: "goal",
      labelField: "name",
      sublabelBuilder: (r) => (r.status as string) || null,
    },
    edges: [],
  },
  sub_goals: {
    entity: {
      entityType: "sub_goal",
      labelField: "name",
      sublabelBuilder: (r) => (r.status as string) || null,
    },
    edges: [
      { foreignKey: "goal_id", targetEntityType: "goal", relationType: "child_of" },
    ],
  },
  pain_points: {
    entity: {
      entityType: "pain_point",
      labelField: "name",
      sublabelBuilder: (r) => {
        const severity = (r.severity as string) || "";
        const status = (r.status as string) || "";
        return [severity, status].filter(Boolean).join(" — ") || null;
      },
    },
    edges: [
      { foreignKey: "linked_goal_id", targetEntityType: "goal", relationType: "linked_to" },
    ],
  },
  teams: {
    entity: {
      entityType: "team",
      labelField: "name",
      sublabelBuilder: (r) => (r.description as string) || null,
    },
    edges: [],
  },
  projects: {
    entity: {
      entityType: "project",
      labelField: "name",
      sublabelBuilder: (r) => (r.active_mode as string) || null,
    },
    edges: [],
  },
  library_items: {
    entity: {
      entityType: "document", // unified
      labelField: "title",
      sublabelBuilder: (r) => (r.category as string) || null,
    },
    edges: [],
  },

  /* ── E-Commerce entities ── */
  ecom_customers: {
    entity: {
      entityType: "person", // unified (was ecom_customers)
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
      entityType: "order", // unified
      labelField: "order_number",
      labelBuilder: (r) => (r.order_number as string) || `Order ${(r.external_id as string) || ""}`,
      sublabelBuilder: (r) => {
        const price = r.total_price ? `$${r.total_price}` : "";
        const status = (r.financial_status as string) || "";
        return [price, status].filter(Boolean).join(" · ") || null;
      },
    },
    edges: [
      { foreignKey: "customer_id", targetEntityType: "person", relationType: "placed_by" },
    ],
  },
  ecom_products: {
    entity: {
      entityType: "product", // unified
      labelField: "title",
      sublabelBuilder: (r) => {
        const type = (r.product_type as string) || "";
        const vendor = (r.vendor as string) || "";
        return [type, vendor].filter(Boolean).join(" · ") || null;
      },
    },
    edges: [],
  },

  /* ── Klaviyo entities ── */
  klaviyo_profiles: {
    entity: {
      entityType: "person", // unified (was klaviyo_profiles)
      labelField: "email",
      labelBuilder: (r) => {
        const first = (r.first_name as string) || "";
        const last = (r.last_name as string) || "";
        const name = `${first} ${last}`.trim();
        return name || (r.email as string) || "Unknown Subscriber";
      },
      sublabelBuilder: () => "Klaviyo subscriber",
    },
    edges: [],
  },
  klaviyo_campaigns: {
    entity: {
      entityType: "campaign", // unified
      labelField: "name",
      sublabelBuilder: (r) => (r.status as string) || null,
    },
    edges: [],
  },
  klaviyo_lists: {
    entity: {
      entityType: "list", // unified
      labelField: "name",
      sublabelBuilder: (r) => {
        const count = r.profile_count as number | undefined;
        return count != null ? `${count} subscribers` : null;
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
 * Searches for target nodes using the unified entity type.
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
    // Target entity types are already unified in TABLE_MAPPINGS
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
 *
 * The entityType parameter is the SOURCE TABLE name (e.g., 'ecom_customers').
 * Internally, this resolves to the unified graph type (e.g., 'person').
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

  // Resolve to unified entity type (the mapping already has it)
  const unifiedType = mapping.entity.entityType;

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

  // Ensure node with UNIFIED entity type
  const nodeId = await ensureGraphNode(
    supabase,
    orgId,
    unifiedType,
    entityId,
    label,
    sublabel,
    userId
  );

  if (!nodeId) return null;

  // Sync edges (target entity types are already unified in TABLE_MAPPINGS)
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
 * Get the supported source table names for graph sync.
 */
export function getSupportedEntityTypes(): string[] {
  return Object.keys(TABLE_MAPPINGS);
}

/**
 * Get all unified entity types that the graph supports.
 */
export function getUnifiedEntityTypes(): string[] {
  return [...new Set(Object.values(SOURCE_TABLE_TO_ENTITY_TYPE))];
}

/* ── Registry Loading (for graph-query display names) ── */

/** In-memory cache: orgId → { labels, timestamp } */
const registryCache = new Map<string, { labels: RegistryLabels; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load entity and relation display names from the DB registry.
 * Merges system defaults with org-specific overrides.
 * Cached per orgId for 5 minutes.
 *
 * Falls back to hardcoded defaults if the registry is empty or query fails.
 */
export async function loadRegistryLabels(
  supabase: SupabaseClient,
  orgId: string
): Promise<RegistryLabels> {
  // Check cache
  const cached = registryCache.get(orgId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.labels;
  }

  try {
    // Load from DB via RPCs
    const [entityResult, relationResult] = await Promise.all([
      supabase.rpc("get_entity_registry", { p_org_id: orgId }),
      supabase.rpc("get_relation_registry", { p_org_id: orgId }),
    ]);

    const entityEntries = (entityResult.data ?? []) as EntityTypeRegistryEntry[];
    const relationEntries = (relationResult.data ?? []) as RelationTypeRegistryEntry[];

    if (entityEntries.length > 0 || relationEntries.length > 0) {
      const labels: RegistryLabels = {
        entityLabels: Object.fromEntries(
          entityEntries.map((e) => [e.entity_type, e.display_name])
        ),
        relationLabels: Object.fromEntries(
          relationEntries.map((r) => [r.relation_type, r.display_name])
        ),
        entityEntries,
        relationEntries,
      };
      registryCache.set(orgId, { labels, ts: Date.now() });
      return labels;
    }
  } catch (err) {
    console.error("[GraphSync] Failed to load registry, falling back to defaults:", err);
  }

  // Fallback to hardcoded defaults
  const fallback: RegistryLabels = {
    entityLabels: FALLBACK_ENTITY_LABELS,
    relationLabels: FALLBACK_RELATION_LABELS,
    entityEntries: [],
    relationEntries: [],
  };
  registryCache.set(orgId, { labels: fallback, ts: Date.now() });
  return fallback;
}

/**
 * Invalidate the registry cache for an org.
 * Call this when registry entries are added/modified.
 */
export function invalidateRegistryCache(orgId: string): void {
  registryCache.delete(orgId);
}

/* ── Fallback labels (backwards compat) ──────────────── */

const FALLBACK_ENTITY_LABELS: Record<string, string> = {
  person: "Person",
  company: "Company",
  pipeline_item: "Pipeline Item",
  order: "Order",
  product: "Product",
  activity: "Activity",
  campaign: "Campaign",
  segment: "Segment",
  document: "Document",
  goal: "Goal",
  sub_goal: "Sub-Goal",
  pain_point: "Pain Point",
  team: "Team",
  project: "Project",
  list: "List",
  // Legacy types (pre-Phase 4) — kept for any nodes that haven't been migrated
  crm_contacts: "Contact",
  crm_companies: "Company",
  crm_deals: "Deal",
  crm_activities: "Activity",
  ecom_customers: "Customer",
  ecom_orders: "Order",
  ecom_products: "Product",
  klaviyo_profiles: "Subscriber",
  klaviyo_campaigns: "Campaign",
  klaviyo_lists: "List",
};

const FALLBACK_RELATION_LABELS: Record<string, string> = {
  works_at: "works at",
  manages: "manages",
  involved_in: "involved in",
  opportunity_for: "opportunity for",
  purchased: "purchased",
  contains: "contains",
  received: "received",
  belongs_to: "belongs to",
  parent_of: "parent of",
  partner_of: "partner of",
  assigned_to: "assigned to",
  account_owner: "account owner",
  documented_in: "documented in",
  same_person: "same person as",
  regarding_contact: "regarding",
  regarding_company: "regarding",
  regarding_deal: "regarding",
  child_of: "sub-goal of",
  linked_to: "linked to",
  primary_contact: "primary contact for",
  for_company: "deal for",
  placed_by: "placed by",
};
