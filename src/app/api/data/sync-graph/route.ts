/**
 * POST /api/data/sync-graph
 *
 * Batch-syncs records from a source table into the knowledge graph.
 * Called after CSV import completes to connect imported data to
 * graph_nodes and graph_edges so the Data Agent can discover
 * relationships and join paths.
 *
 * Also works as a one-time backfill for existing data that was
 * imported before graph sync was wired up.
 *
 * Phase 4: Uses unified entity types (person, company, etc.) via
 * syncRecordToGraph which internally resolves source table → unified type.
 *
 * Body: { table: string, batchSize?: number }
 * Returns: { synced: number, total: number, errors: number }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { syncRecordToGraph, getSupportedEntityTypes } from "@/lib/agentic/graph-sync";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const BATCH_DELAY_MS = 100; // small delay between batches to avoid hammering DB

// Use getSupportedEntityTypes() so this stays in sync with TABLE_MAPPINGS
const SYNCABLE_TABLES = new Set(getSupportedEntityTypes());

export async function POST(req: Request) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  let body: { table: string; batchSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { table } = body;
  if (!table || !SYNCABLE_TABLES.has(table)) {
    return NextResponse.json(
      {
        error: `Invalid table. Must be one of: ${[...SYNCABLE_TABLES].join(", ")}`,
      },
      { status: 400 }
    );
  }

  const batchSize = Math.min(
    body.batchSize || DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE
  );

  try {
    // Count total records for this org
    const { count, error: countError } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (countError) {
      return NextResponse.json(
        { error: `Failed to count records: ${countError.message}` },
        { status: 500 }
      );
    }

    const total = count || 0;
    if (total === 0) {
      return NextResponse.json({ synced: 0, total: 0, errors: 0 });
    }

    // Process in batches
    let synced = 0;
    let errors = 0;
    let offset = 0;

    while (offset < total) {
      const { data: records, error: fetchError } = await supabase
        .from(table)
        .select("*")
        .eq("org_id", orgId)
        .range(offset, offset + batchSize - 1);

      if (fetchError || !records) {
        console.error(`[sync-graph] Fetch error at offset ${offset}:`, fetchError?.message);
        errors += batchSize;
        offset += batchSize;
        continue;
      }

      // Sync each record in this batch
      // syncRecordToGraph internally resolves table → unified entity type
      for (const record of records) {
        try {
          await syncRecordToGraph(
            supabase,
            orgId,
            table,
            record.id,
            record,
            user.id
          );
          synced++;
        } catch (err) {
          console.error(
            `[sync-graph] Failed to sync ${table}/${record.id}:`,
            err instanceof Error ? err.message : err
          );
          errors++;
        }
      }

      offset += batchSize;

      // Small delay between batches to avoid overwhelming the database
      if (offset < total) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log(
      `[sync-graph] Completed: ${table} — ${synced} synced, ${errors} errors, ${total} total`
    );

    return NextResponse.json({ synced, total, errors });
  } catch (err) {
    console.error("[sync-graph] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
