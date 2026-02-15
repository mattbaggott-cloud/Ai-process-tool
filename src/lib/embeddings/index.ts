/**
 * High-level embedding operations
 * Combines chunking + embedding + Supabase storage
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbeddings } from "./client";
import { chunkDocument } from "./chunker";

/**
 * Embed a document: chunk it, generate embeddings, upsert into document_chunks.
 * This should be called fire-and-forget (never block CRUD responses).
 */
export async function embedDocument(
  supabase: SupabaseClient,
  userId: string,
  sourceTable: string,
  sourceId: string,
  record: Record<string, unknown>
): Promise<{ chunkCount: number }> {
  try {
    const chunks = chunkDocument(sourceTable, sourceId, record);
    if (chunks.length === 0) return { chunkCount: 0 };

    // Batch embed all chunk texts
    const embeddings = await getEmbeddings(chunks.map((c) => c.text));

    // Build rows for upsert
    const rows = chunks.map((chunk, i) => ({
      user_id: userId,
      source_table: sourceTable,
      source_id: sourceId,
      source_field: "content",
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      metadata: chunk.metadata,
      embedding: JSON.stringify(embeddings[i]),
      updated_at: new Date().toISOString(),
    }));

    // Upsert using the unique constraint
    const { error } = await supabase
      .from("document_chunks")
      .upsert(rows, {
        onConflict: "source_table,source_id,source_field,chunk_index",
      });

    if (error) {
      console.error(`Embedding upsert failed for ${sourceTable}/${sourceId}:`, error);
      return { chunkCount: 0 };
    }

    return { chunkCount: chunks.length };
  } catch (err) {
    console.error(`embedDocument failed for ${sourceTable}/${sourceId}:`, err);
    return { chunkCount: 0 };
  }
}

/**
 * Delete all chunks for a source record.
 * Call when the source record is deleted.
 */
export async function deleteDocumentChunks(
  supabase: SupabaseClient,
  sourceTable: string,
  sourceId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("document_chunks")
      .delete()
      .eq("source_table", sourceTable)
      .eq("source_id", sourceId);

    if (error) {
      console.error(`deleteDocumentChunks failed for ${sourceTable}/${sourceId}:`, error);
    }
  } catch (err) {
    console.error(`deleteDocumentChunks error:`, err);
  }
}

/**
 * Re-embed a document: delete old chunks then re-embed.
 * Call when the source record is updated.
 */
export async function reembedDocument(
  supabase: SupabaseClient,
  userId: string,
  sourceTable: string,
  sourceId: string,
  record: Record<string, unknown>
): Promise<{ chunkCount: number }> {
  await deleteDocumentChunks(supabase, sourceTable, sourceId);
  return embedDocument(supabase, userId, sourceTable, sourceId, record);
}

/**
 * Fire-and-forget embedding — use this in CRUD handlers
 * so embedding never blocks the response.
 */
export function embedInBackground(
  supabase: SupabaseClient,
  userId: string,
  sourceTable: string,
  sourceId: string,
  record: Record<string, unknown>
): void {
  Promise.resolve()
    .then(() => embedDocument(supabase, userId, sourceTable, sourceId, record))
    .catch((err) => console.error("Background embed failed:", err));
}

/**
 * Fire-and-forget re-embed
 */
export function reembedInBackground(
  supabase: SupabaseClient,
  userId: string,
  sourceTable: string,
  sourceId: string,
  record: Record<string, unknown>
): void {
  Promise.resolve()
    .then(() => reembedDocument(supabase, userId, sourceTable, sourceId, record))
    .catch((err) => console.error("Background reembed failed:", err));
}

/**
 * Fire-and-forget delete chunks
 */
export function deleteChunksInBackground(
  supabase: SupabaseClient,
  sourceTable: string,
  sourceId: string
): void {
  Promise.resolve()
    .then(() => deleteDocumentChunks(supabase, sourceTable, sourceId))
    .catch((err) => console.error("Background chunk delete failed:", err));
}
