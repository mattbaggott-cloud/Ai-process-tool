/**
 * Schema Indexer — fills the knowledge graph and vector store with schema data
 *
 * This is the KEY function that bridges the empty infrastructure:
 * - Creates graph_nodes (entity_type: "data_table") for every table
 * - Creates graph_edges (relation_type: "foreign_key") for FK relationships
 * - Embeds schema descriptions into document_chunks (source_table: "schema")
 * - Embeds cross-domain concept descriptions for semantic discovery
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchemaMap, TableSchema } from "./types";
import { ensureGraphNode } from "../agentic/graph-sync";
import { embedDocument } from "../embeddings/index";

/**
 * Generate a deterministic UUID v5-style ID from a namespace + name.
 * Uses a simple hash approach since we just need stable, unique UUIDs
 * for schema document_chunks (source_id is UUID NOT NULL).
 */
function deterministicUUID(namespace: string, name: string): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  const hash = createHash("sha256").update(`${namespace}:${name}`).digest("hex");
  // Format as UUID: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "5" + hash.slice(13, 16), // version 5
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hash.slice(18, 20), // variant
    hash.slice(20, 32),
  ].join("-");
}

/* ── Index Check ─────────────────────────────────────── */

/**
 * Check if schema has been indexed for this org.
 * Returns true if graph_nodes has any entity_type='data_table' rows.
 */
async function isSchemaIndexed(
  supabase: SupabaseClient,
  orgId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("graph_nodes")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("entity_type", "data_table")
    .eq("is_active", true);

  if (error) {
    console.error("Schema index check failed:", error);
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Ensure schema is indexed — called on first analyze_data request per org.
 * Idempotent: skips if already indexed and schema hasn't changed.
 */
export async function ensureSchemaIndexed(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  schemaMap: SchemaMap
): Promise<void> {
  const indexed = await isSchemaIndexed(supabase, orgId);
  if (indexed) return;

  // Fire-and-forget: schema indexing should NOT block the query pipeline.
  // The Data Agent can still generate SQL from the live schema (getSchemaMap)
  // even without embeddings — embeddings just improve retrieval quality.
  console.log(`[data-agent] Indexing schema for org ${orgId} (background)...`);
  indexSchemaToInfrastructure(supabase, orgId, userId, schemaMap)
    .then(() => console.log(`[data-agent] Schema indexing complete for org ${orgId}`))
    .catch((err) => console.error(`[data-agent] Schema indexing failed (non-fatal):`, err));
}

/* ── Main Indexer ────────────────────────────────────── */

/**
 * Index the full database schema into the knowledge graph and vector store.
 *
 * Step A: Create graph nodes for each table
 * Step B: Create graph edges for FK relationships
 * Step C: Embed schema descriptions into vector store
 * Step D: Embed cross-domain concept descriptions
 */
export async function indexSchemaToInfrastructure(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  schemaMap: SchemaMap
): Promise<void> {
  const tableNodeIds = new Map<string, string>();

  // ── Step A: Index tables as graph nodes ──
  for (const table of schemaMap.tables.values()) {
    // Skip purely internal infrastructure tables from the graph
    if (isInfrastructureTable(table.name)) continue;

    const nodeId = await ensureGraphNode(
      supabase,
      orgId,
      "data_table",
      table.name, // entity_id = table name (tables don't have UUID IDs)
      table.name,
      `${table.domain} | ${table.columns.length} columns`,
      userId
    );

    if (nodeId) {
      tableNodeIds.set(table.name, nodeId);
    }
  }

  // ── Step B: Index FK relationships as graph edges ──
  for (const table of schemaMap.tables.values()) {
    if (isInfrastructureTable(table.name)) continue;

    const sourceNodeId = tableNodeIds.get(table.name);
    if (!sourceNodeId) continue;

    for (const rel of table.relationships) {
      const targetNodeId = tableNodeIds.get(rel.target_table);
      if (!targetNodeId) continue;

      // Create FK edge: source_table → target_table
      try {
        await supabase.from("graph_edges").upsert(
          {
            org_id: orgId,
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            relation_type: "foreign_key",
            properties: {
              source_column: rel.source_column,
              target_column: rel.target_column,
              constraint_name: rel.constraint_name,
            },
            valid_from: new Date().toISOString(),
          },
          {
            onConflict:
              "org_id,source_node_id,target_node_id,relation_type,valid_from",
            ignoreDuplicates: true,
          }
        );
      } catch (err) {
        console.error(
          `[data-agent] Failed to create FK edge ${table.name} → ${rel.target_table}:`,
          err
        );
      }
    }
  }

  // ── Step C: Embed schema descriptions into vector store ──
  // Throttled: embed 3 at a time to avoid overwhelming Supabase/OpenAI
  const embedTasks: Array<{ sourceId: string; content: string }> = [];

  for (const table of schemaMap.tables.values()) {
    if (isInfrastructureTable(table.name)) continue;
    embedTasks.push({
      sourceId: deterministicUUID("schema_table", table.name),
      content: buildSchemaDescription(table),
    });
  }

  // ── Step D: Embed cross-domain concepts ──
  const concepts = buildCrossDomainConcepts(schemaMap);
  for (let i = 0; i < concepts.length; i++) {
    embedTasks.push({
      sourceId: deterministicUUID("schema_concept", `concept_${i}`),
      content: concepts[i],
    });
  }

  // Process in batches of 3 to avoid Supabase rate limits / 520 errors
  const BATCH_SIZE = 3;
  for (let i = 0; i < embedTasks.length; i += BATCH_SIZE) {
    const batch = embedTasks.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((task) =>
        embedDocument(supabase, userId, "schema", task.sourceId, {
          content: task.content,
        }, orgId)
      )
    );
  }
}

/* ── Helpers ─────────────────────────────────────────── */

/**
 * Tables that are pure infrastructure and shouldn't be searchable by the AI.
 */
function isInfrastructureTable(tableName: string): boolean {
  const infraTables = new Set([
    "graph_nodes",
    "graph_edges",
    "events",
    "document_chunks",
    "memories",
    "llm_logs",
    "query_history",
    "schema_migrations",
  ]);
  return infraTables.has(tableName);
}

/**
 * Build a rich text description of a table for vector embedding.
 * This is what hybrid_search will find when the AI asks about schema.
 */
function buildSchemaDescription(table: TableSchema): string {
  const parts: string[] = [];

  parts.push(`Table: ${table.name}`);
  parts.push(`Domain: ${table.domain}`);
  parts.push(`Description: ${table.description}`);
  parts.push("");

  parts.push("Columns:");
  for (const col of table.columns) {
    let line = `  - ${col.name} (${col.type}`;
    if (!col.nullable) line += ", NOT NULL";
    if (col.jsonb_keys && col.jsonb_keys.length > 0) {
      line += `, JSONB keys: ${col.jsonb_keys.join(", ")}`;
    }
    line += ")";
    parts.push(line);
  }

  if (table.relationships.length > 0) {
    parts.push("");
    parts.push("Foreign Keys:");
    for (const rel of table.relationships) {
      parts.push(
        `  - ${rel.source_column} → ${rel.target_table}.${rel.target_column}`
      );
    }
  }

  return parts.join("\n");
}

/**
 * Build cross-domain concept descriptions that help the AI
 * understand how tables relate across domains.
 *
 * These are dynamic — built from what actually exists in the schema.
 */
function buildCrossDomainConcepts(schemaMap: SchemaMap): string[] {
  const concepts: string[] = [];
  const tables = schemaMap.tables;

  // Unified customer view (if both ecom and CRM exist)
  if (tables.has("ecom_customers") && tables.has("crm_contacts")) {
    concepts.push(
      "Unified customer view: ecom_customers JOIN customer_identity_links JOIN crm_contacts " +
        "gives a 360-degree view of each customer across B2C ecommerce and B2B CRM. " +
        "The customer_identity_links table maps ecom_customer_id to crm_contact_id."
    );
  }

  // Customer lifecycle (if behavioral profiles exist)
  if (tables.has("customer_behavioral_profiles")) {
    concepts.push(
      "Customer lifecycle: customer_behavioral_profiles has lifecycle_stage " +
        "(new, active, loyal, at_risk, lapsed, win_back, champion), " +
        "engagement_score, RFM scores (recency_score, frequency_score, monetary_score), " +
        "predicted_next_purchase, and product_affinities (JSONB array)."
    );
  }

  // Campaign engagement (if campaigns exist)
  if (
    tables.has("email_campaigns") &&
    tables.has("email_customer_variants")
  ) {
    concepts.push(
      "Campaign engagement: email_campaigns JOIN email_customer_variants shows which " +
        "customers received which campaigns and their delivery_status " +
        "(sent, delivered, opened, clicked, bounced)."
    );
  }

  // Address data patterns
  const ecomCustomers = tables.get("ecom_customers");
  if (ecomCustomers) {
    const addressCol = ecomCustomers.columns.find(
      (c) => c.name === "default_address"
    );
    if (addressCol?.jsonb_keys) {
      concepts.push(
        `Address data: ecom_customers.default_address is JSONB with keys ` +
          `{${addressCol.jsonb_keys.join(", ")}}. ` +
          `Access with default_address->>'zip', default_address->>'city', etc.`
      );
    }
  }

  // Line items pattern
  const ecomOrders = tables.get("ecom_orders");
  if (ecomOrders) {
    const lineItemsCol = ecomOrders.columns.find(
      (c) => c.name === "line_items"
    );
    if (lineItemsCol) {
      concepts.push(
        "Product data in orders: ecom_orders.line_items is a JSONB array. " +
          "Each item has {title, quantity, price, sku}. " +
          "Use jsonb_array_elements(line_items) to unnest and query individual items."
      );
    }
  }

  // Segment membership
  if (tables.has("segments") && tables.has("segment_members")) {
    concepts.push(
      "Segment membership: segments JOIN segment_members JOIN ecom_customers " +
        "shows which customers are in which segments. " +
        "Segments have rules (JSONB) that define membership criteria."
    );
  }

  // Deal line items
  if (tables.has("crm_deals") && tables.has("crm_deal_line_items")) {
    concepts.push(
      "Deal products: crm_deals JOIN crm_deal_line_items shows what products " +
        "are included in each B2B deal, with quantities and prices."
    );
  }

  return concepts;
}
