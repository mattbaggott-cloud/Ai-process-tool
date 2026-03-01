/**
 * Google Drive Sync Service — Hybrid Approach
 *
 * Layer 1: Metadata sync (lightweight) — file names, types, folders, dates
 * Layer 2: Selective indexing — user picks files → content embedded into knowledge base
 * Layer 3: On-demand read tool — AI fetches file content in real-time during conversations
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  type GoogleConnectorConfig,
  googleApiFetch,
} from "@/lib/google/oauth";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { embedInBackground, deleteChunksInBackground } from "@/lib/embeddings/index";
import { syncRecordToGraphInBackground, deactivateNode } from "@/lib/agentic/graph-sync";

/* ── Types ─────────────────────────────────────────────── */

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface IndexFileStatus {
  fileId: string;
  fileName: string;
  status: "indexed" | "skipped" | "error" | "removed";
  reason?: string;
}

export interface IndexResult extends SyncResult {
  fileStatuses: IndexFileStatus[];
}

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  parents?: string[];
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  sharedWithMeTime?: string;
  modifiedTime?: string;
  createdTime?: string;
}

interface DriveApiFileList {
  files: DriveApiFile[];
  nextPageToken?: string;
}

/* ── Constants ─────────────────────────────────────────── */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const MAX_FILES = 2000;
const PAGE_SIZE = 100;

/** Supported MIME types for content extraction */
const INDEXABLE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",       // Google Docs
  "application/vnd.google-apps.spreadsheet",     // Google Sheets
  "application/vnd.google-apps.presentation",    // Google Slides
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",        // .xlsx
]);

/** Google Workspace export MIME types */
const EXPORT_MIME_MAP: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/* ── Layer 1: Metadata Sync ────────────────────────────── */

/**
 * Sync file metadata from Google Drive.
 * Lightweight — only stores names, types, folders, dates.
 */
export async function syncFileMetadata(
  config: GoogleConnectorConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  let allFiles: DriveApiFile[] = [];
  let pageToken: string | undefined;

  // Fetch file metadata (paginated)
  while (allFiles.length < MAX_FILES) {
    const listUrl = new URL(`${DRIVE_API}/files`);
    listUrl.searchParams.set("pageSize", String(PAGE_SIZE));
    listUrl.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,size,webViewLink,iconLink,parents,owners,modifiedTime,createdTime)",
    );
    listUrl.searchParams.set("orderBy", "modifiedTime desc");
    // Exclude trashed files and folders
    listUrl.searchParams.set("q", "trashed = false and mimeType != 'application/vnd.google-apps.folder'");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const res = await googleApiFetch(listUrl.toString(), config.access_token);
    const data = (await res.json()) as DriveApiFileList;

    allFiles.push(...(data.files || []));

    pageToken = data.nextPageToken;
    if (!pageToken || (data.files || []).length === 0) break;
  }

  // Also fetch folder names for parent resolution
  const folderIds = new Set<string>();
  for (const f of allFiles) {
    if (f.parents) {
      for (const p of f.parents) folderIds.add(p);
    }
  }

  const folderNames = new Map<string, string>();
  for (const folderId of folderIds) {
    try {
      const folderRes = await googleApiFetch(
        `${DRIVE_API}/files/${folderId}?fields=name`,
        config.access_token,
      );
      const folder = await folderRes.json();
      folderNames.set(folderId, folder.name || "");
    } catch {
      // Folder may be inaccessible
    }
  }

  // Upsert file metadata
  for (const file of allFiles) {
    try {
      const parentId = file.parents?.[0] || null;
      const parentName = parentId ? folderNames.get(parentId) || null : null;

      const row = {
        org_id: orgId,
        user_id: userId,
        external_id: file.id,
        name: file.name,
        mime_type: file.mimeType,
        size_bytes: file.size ? parseInt(file.size, 10) : null,
        web_view_link: file.webViewLink || null,
        icon_link: file.iconLink || null,
        parent_folder_id: parentId,
        parent_folder_name: parentName,
        owners: JSON.stringify(
          (file.owners || []).map((o) => ({
            email: o.emailAddress,
            name: o.displayName,
          })),
        ),
        modified_time: file.modifiedTime || null,
        created_time: file.createdTime || null,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("drive_files")
        .upsert(row, { onConflict: "org_id,external_id" });

      if (error) {
        console.error(`Drive file upsert error for ${file.id}:`, error.message);
        result.errors++;
      } else {
        result.created++;
      }
    } catch (err) {
      console.error(`Drive file processing error for ${file.id}:`, err);
      result.errors++;
    }
  }

  return result;
}

/* ── Layer 2: Selective Indexing ────────────────────────── */

/**
 * Index selected files into the knowledge base.
 * Fetches content, creates library_items, embeds via the embedding pipeline,
 * and creates knowledge graph nodes for discoverability.
 *
 * When forceReindex is true, already-indexed files are re-processed:
 * old library_item, embeddings, and graph node are cleaned up before fresh indexing.
 */
export async function indexFiles(
  config: GoogleConnectorConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  fileIds: string[],
  options: { forceReindex?: boolean } = {},
): Promise<IndexResult> {
  const { forceReindex = false } = options;
  const result: IndexResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    fileStatuses: [],
  };

  for (const fileId of fileIds) {
    try {
      // Get file metadata from our DB
      const { data: driveFile } = await supabase
        .from("drive_files")
        .select("*")
        .eq("org_id", orgId)
        .eq("external_id", fileId)
        .single();

      if (!driveFile) {
        result.skipped++;
        result.fileStatuses.push({
          fileId,
          fileName: fileId,
          status: "skipped",
          reason: "File not found in synced metadata — try syncing first",
        });
        continue;
      }

      // Handle already-indexed files
      if (driveFile.is_indexed && driveFile.library_item_id) {
        if (!forceReindex) {
          result.skipped++;
          result.fileStatuses.push({
            fileId,
            fileName: driveFile.name,
            status: "skipped",
            reason: "Already indexed",
          });
          continue;
        }

        // Clean up old data before re-indexing
        await cleanupIndexedFile(supabase, orgId, driveFile.library_item_id, driveFile.id);
      }

      // Fetch content — readFileContent throws on failure with a reason
      let content: string;
      try {
        content = await readFileContent(config, fileId, driveFile.mime_type);
      } catch (readErr) {
        const reason = readErr instanceof Error ? readErr.message : "Content extraction failed";
        console.error(`[Drive index] Content extraction failed for "${driveFile.name}" (${driveFile.mime_type}): ${reason}`);
        result.errors++;
        result.fileStatuses.push({
          fileId,
          fileName: driveFile.name,
          status: "error",
          reason,
        });
        continue;
      }

      // Create library_item
      const libraryRecord = {
        org_id: orgId,
        user_id: userId,
        title: driveFile.name,
        content: content.slice(0, 100000),
        category: "Document",
        tags: ["google-drive", driveFile.mime_type?.split("/").pop() || "file"],
        source_type: "import",
      };

      const { data: libraryItem, error: libError } = await supabase
        .from("library_items")
        .insert(libraryRecord)
        .select("id")
        .single();

      if (libError || !libraryItem) {
        const reason = libError?.message || "Failed to create knowledge base entry";
        console.error(`[Drive index] Library item insert failed for "${driveFile.name}": ${reason}`);
        result.errors++;
        result.fileStatuses.push({
          fileId,
          fileName: driveFile.name,
          status: "error",
          reason,
        });
        continue;
      }

      // Embed into vector store so search_library can find it
      embedInBackground(supabase, userId, "library_items", libraryItem.id, {
        title: driveFile.name,
        content: content.slice(0, 100000),
        category: "Document",
        tags: ["google-drive", driveFile.mime_type?.split("/").pop() || "file"],
      }, orgId);

      // Create knowledge graph node (entity_type: "document" via library_items mapping)
      syncRecordToGraphInBackground(
        supabase,
        orgId,
        "library_items",
        libraryItem.id,
        { title: driveFile.name, category: "Document" },
        userId,
      );

      // Mark as indexed in drive_files
      await supabase
        .from("drive_files")
        .update({
          is_indexed: true,
          library_item_id: libraryItem.id,
        })
        .eq("id", driveFile.id);

      const isReindex = forceReindex && driveFile.is_indexed;
      if (isReindex) {
        result.updated++;
      } else {
        result.created++;
      }
      result.fileStatuses.push({
        fileId,
        fileName: driveFile.name,
        status: "indexed",
        reason: isReindex ? "Re-indexed with fresh content" : undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unexpected error";
      console.error(`[Drive index] Unexpected error for ${fileId}: ${reason}`);
      result.errors++;
      result.fileStatuses.push({
        fileId,
        fileName: fileId,
        status: "error",
        reason,
      });
    }
  }

  return result;
}

/**
 * Remove files from the knowledge base.
 * Deletes library_items, embeddings, deactivates graph nodes,
 * and resets the drive_files indexed flags.
 */
export async function unindexFiles(
  supabase: SupabaseClient,
  orgId: string,
  fileIds: string[],
): Promise<IndexResult> {
  const result: IndexResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    fileStatuses: [],
  };

  for (const fileId of fileIds) {
    try {
      const { data: driveFile } = await supabase
        .from("drive_files")
        .select("*")
        .eq("org_id", orgId)
        .eq("external_id", fileId)
        .single();

      if (!driveFile) {
        result.skipped++;
        result.fileStatuses.push({
          fileId,
          fileName: fileId,
          status: "skipped",
          reason: "File not found",
        });
        continue;
      }

      if (!driveFile.is_indexed || !driveFile.library_item_id) {
        result.skipped++;
        result.fileStatuses.push({
          fileId,
          fileName: driveFile.name,
          status: "skipped",
          reason: "Not currently indexed",
        });
        continue;
      }

      await cleanupIndexedFile(supabase, orgId, driveFile.library_item_id, driveFile.id);

      result.updated++;
      result.fileStatuses.push({
        fileId,
        fileName: driveFile.name,
        status: "removed",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unexpected error";
      console.error(`[Drive unindex] Error for ${fileId}: ${reason}`);
      result.errors++;
      result.fileStatuses.push({
        fileId,
        fileName: fileId,
        status: "error",
        reason,
      });
    }
  }

  return result;
}

/**
 * Clean up all indexed artifacts for a file:
 * 1. Delete embeddings (document_chunks)
 * 2. Deactivate graph node
 * 3. Delete library_item
 * 4. Reset drive_files flags
 */
async function cleanupIndexedFile(
  supabase: SupabaseClient,
  orgId: string,
  libraryItemId: string,
  driveFileId: string,
): Promise<void> {
  // Delete embeddings
  deleteChunksInBackground(supabase, "library_items", libraryItemId);

  // Deactivate graph node (soft delete — preserves history)
  deactivateNode(supabase, orgId, "document", libraryItemId);

  // Delete the library_item
  await supabase
    .from("library_items")
    .delete()
    .eq("id", libraryItemId);

  // Reset drive_files flags
  await supabase
    .from("drive_files")
    .update({
      is_indexed: false,
      library_item_id: null,
    })
    .eq("id", driveFileId);
}

/* ── Layer 3: On-Demand Read ───────────────────────────── */

/**
 * Read file content from Google Drive on demand.
 * Handles Google Workspace files (export as text), PDFs (pdf-parse),
 * .docx (mammoth), and regular text files (download).
 *
 * THROWS on failure — callers must handle errors.
 */
export async function readFileContent(
  config: GoogleConnectorConfig,
  fileId: string,
  mimeType?: string | null,
): Promise<string> {
  // Google Workspace files — export as text
  const exportMime = mimeType ? EXPORT_MIME_MAP[mimeType] : undefined;
  if (exportMime) {
    const exportUrl = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
    const res = await googleApiFetch(exportUrl, config.access_token);
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      throw new Error(`Google export returned empty content (${mimeType})`);
    }
    return text;
  }

  // PDF — download binary and extract text via pdf-parse v2
  if (mimeType === "application/pdf") {
    const downloadUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
    const res = await googleApiFetch(downloadUrl, config.access_token);
    const arrayBuf = await res.arrayBuffer();
    const parser = new PDFParse({ data: arrayBuf });
    const textResult = await parser.getText();
    await parser.destroy();
    const text = textResult.text?.trim();
    if (!text || text.length === 0) {
      throw new Error("PDF contains no extractable text (may be scanned/image-only)");
    }
    return text.slice(0, 100000);
  }

  // .docx — download binary and extract text via mammoth
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const downloadUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
    const res = await googleApiFetch(downloadUrl, config.access_token);
    const buffer = Buffer.from(await res.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim();
    if (!text || text.length === 0) {
      throw new Error("Word document contains no extractable text");
    }
    return text.slice(0, 100000);
  }

  // .xlsx — not suited for knowledge-base text indexing
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new Error("Excel files (.xlsx) contain structured data — use Google Sheets export or CSV for indexing");
  }

  // Text-based files (text/plain, text/csv, text/markdown)
  const downloadUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
  const res = await googleApiFetch(downloadUrl, config.access_token);
  const text = await res.text();
  if (!text || text.trim().length === 0) {
    throw new Error(`File contains no text content (${mimeType})`);
  }
  return text.slice(0, 100000);
}

/**
 * Check if a file type is indexable (content can be extracted).
 */
export function isIndexable(mimeType: string): boolean {
  return INDEXABLE_MIME_TYPES.has(mimeType);
}

/* ── Helpers ───────────────────────────────────────────── */

/**
 * Log a sync event to data_sync_log.
 */
export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    connector_id: connectorId,
    event_type: eventType,
    message,
    details,
  });
}
