/**
 * Schema Introspection — reads live database schema
 *
 * Uses information_schema RPCs to discover all tables, columns,
 * FK relationships, and JSONB key structures. Caches with 5-min TTL.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SchemaMap,
  TableSchema,
  ColumnSchema,
  RelationshipSchema,
  DomainType,
} from "./types";

/* ── In-memory cache ─────────────────────────────────── */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const schemaCache = new Map<string, SchemaMap>();

/**
 * Get the complete schema map for an org.
 * Reads from cache if fresh, otherwise introspects the database.
 */
export async function getSchemaMap(
  supabase: SupabaseClient,
  orgId: string
): Promise<SchemaMap> {
  const cached = schemaCache.get(orgId);
  if (cached && Date.now() - cached.indexed_at < CACHE_TTL_MS) {
    return cached;
  }

  const schemaMap = await introspectSchema(supabase);
  schemaCache.set(orgId, schemaMap);
  return schemaMap;
}

/**
 * Force-refresh the schema cache for an org.
 */
export function invalidateSchemaCache(orgId: string): void {
  schemaCache.delete(orgId);
}

/* ── Core introspection ──────────────────────────────── */

async function introspectSchema(supabase: SupabaseClient): Promise<SchemaMap> {
  // Step 1: Get all columns
  const { data: columnsData, error: columnsError } = await supabase.rpc(
    "get_platform_schema"
  );
  if (columnsError) {
    console.error("get_platform_schema failed:", columnsError);
    throw new Error(`Schema introspection failed: ${columnsError.message}`);
  }

  // Step 2: Get all FK relationships
  const { data: relsData, error: relsError } = await supabase.rpc(
    "get_table_relationships"
  );
  if (relsError) {
    console.error("get_table_relationships failed:", relsError);
    throw new Error(`Relationship introspection failed: ${relsError.message}`);
  }

  // Step 3: Build table map
  const tables = new Map<string, TableSchema>();

  // Group columns by table
  const columnsByTable = new Map<string, ColumnSchema[]>();
  for (const row of columnsData || []) {
    const tableName = row.table_name as string;
    if (!columnsByTable.has(tableName)) {
      columnsByTable.set(tableName, []);
    }
    columnsByTable.get(tableName)!.push({
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: (row.is_nullable as string) === "YES",
      default_value: row.column_default as string | null,
    });
  }

  // Group relationships by source table
  const relsByTable = new Map<string, RelationshipSchema[]>();
  for (const row of relsData || []) {
    const sourceTable = row.source_table as string;
    if (!relsByTable.has(sourceTable)) {
      relsByTable.set(sourceTable, []);
    }
    relsByTable.get(sourceTable)!.push({
      target_table: row.target_table as string,
      source_column: row.source_column as string,
      target_column: row.target_column as string,
      constraint_name: row.constraint_name as string,
    });
  }

  // Step 4: Sample JSONB columns for key discovery
  const jsonbColumns: Array<{ table: string; column: string }> = [];
  for (const [tableName, columns] of columnsByTable) {
    for (const col of columns) {
      if (col.type === "jsonb" || col.type === "ARRAY") {
        jsonbColumns.push({ table: tableName, column: col.name });
      }
    }
  }

  const jsonbKeys = await sampleJsonbKeys(supabase, jsonbColumns);

  // Step 5: Assemble TableSchema objects
  for (const [tableName, columns] of columnsByTable) {
    // Annotate JSONB columns with discovered keys
    for (const col of columns) {
      const key = `${tableName}.${col.name}`;
      if (jsonbKeys.has(key)) {
        col.jsonb_keys = jsonbKeys.get(key);
      }
    }

    const domain = classifyDomain(tableName);
    const description = generateTableDescription(tableName, columns, domain);

    tables.set(tableName, {
      name: tableName,
      columns,
      relationships: relsByTable.get(tableName) || [],
      description,
      domain,
    });
  }

  return {
    tables,
    indexed_at: Date.now(),
  };
}

/* ── JSONB Key Sampling ──────────────────────────────── */

async function sampleJsonbKeys(
  supabase: SupabaseClient,
  columns: Array<{ table: string; column: string }>
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  // Sample in parallel, but limit concurrency
  const BATCH_SIZE = 5;
  for (let i = 0; i < columns.length; i += BATCH_SIZE) {
    const batch = columns.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async ({ table, column }) => {
      try {
        // Use raw SQL to sample JSONB keys
        const { data, error } = await supabase.rpc("exec_safe_sql", {
          // Use a dummy org_id — this query doesn't filter by org, but the RPC requires it.
          // The keys are schema-level, same across all orgs.
          p_org_id: "00000000-0000-0000-0000-000000000000",
          p_sql: `SELECT DISTINCT k FROM (
            SELECT jsonb_object_keys(${column}) AS k
            FROM ${table}
            WHERE ${column} IS NOT NULL
              AND jsonb_typeof(${column}) = 'object'
            LIMIT 10
          ) sub LIMIT 50`,
          p_timeout_ms: 3000,
        });

        if (!error && data) {
          const parsed = typeof data === "string" ? JSON.parse(data) : data;
          const keys = Array.isArray(parsed)
            ? parsed.map((row: Record<string, unknown>) => row.k as string)
            : [];
          if (keys.length > 0) {
            result.set(`${table}.${column}`, keys);
          }
        }
      } catch {
        // Silently skip — some JSONB columns may contain arrays or non-objects
      }
    });
    await Promise.all(promises);
  }

  return result;
}

/* ── Domain Classification ───────────────────────────── */

/**
 * Classify a table into a domain based on naming conventions.
 * New tables from new platform connectors are auto-classified by prefix.
 */
function classifyDomain(tableName: string): DomainType {
  // Ecommerce tables
  if (tableName.startsWith("ecom_")) return "ecommerce";

  // CRM tables
  if (tableName.startsWith("crm_")) return "crm";

  // Campaign/email tables
  if (
    tableName.startsWith("email_") ||
    tableName.startsWith("campaign_")
  )
    return "campaigns";

  // Behavioral / segmentation tables
  if (
    tableName === "customer_behavioral_profiles" ||
    tableName === "segments" ||
    tableName === "segment_members"
  )
    return "behavioral";

  // Identity resolution
  if (tableName === "customer_identity_links") return "identity";

  // Everything else is internal
  return "internal";
}

/* ── Description Generation ──────────────────────────── */

function generateTableDescription(
  tableName: string,
  columns: ColumnSchema[],
  domain: DomainType
): string {
  const colList = columns
    .map((c) => {
      let desc = `${c.name} (${c.type}`;
      if (c.jsonb_keys && c.jsonb_keys.length > 0) {
        desc += `, keys: ${c.jsonb_keys.join(", ")}`;
      }
      desc += ")";
      return desc;
    })
    .join(", ");

  return `Table: ${tableName} | Domain: ${domain} | Columns: ${colList}`;
}

/**
 * Get a list of domains that have data tables.
 * Used by the Planner for ambiguity detection.
 */
export function getAvailableDomains(schemaMap: SchemaMap): DomainType[] {
  const domains = new Set<DomainType>();
  for (const table of schemaMap.tables.values()) {
    if (table.domain !== "internal") {
      domains.add(table.domain);
    }
  }
  return Array.from(domains);
}

/**
 * Get tables for a specific domain.
 */
export function getTablesForDomain(
  schemaMap: SchemaMap,
  domain: string
): TableSchema[] {
  const result: TableSchema[] = [];
  for (const table of schemaMap.tables.values()) {
    if (table.domain === domain) {
      result.push(table);
    }
  }
  return result;
}

/**
 * Get a single table schema by name.
 */
export function getTable(
  schemaMap: SchemaMap,
  tableName: string
): TableSchema | undefined {
  return schemaMap.tables.get(tableName);
}
