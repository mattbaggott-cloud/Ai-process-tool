"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface DriveFile {
  id: string;
  external_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  parent_folder_name: string | null;
  modified_time: string | null;
  is_indexed: boolean;
  web_view_link: string | null;
}

interface FileStatus {
  fileId: string;
  fileName: string;
  status: "indexed" | "skipped" | "error" | "removed";
  reason?: string;
}

interface OperationResult {
  created: number;
  updated: number;
  errors: number;
  fileStatuses?: FileStatus[];
}

interface Props {
  onClose: () => void;
}

const MIME_TYPE_LABELS: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Doc",
  "application/vnd.google-apps.spreadsheet": "Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
};

export default function DriveFileBrowser({ onClose }: Props) {
  const supabase = createClient();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [operating, setOperating] = useState(false);
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("drive_files")
      .select("id, external_id, name, mime_type, size_bytes, parent_folder_name, modified_time, is_indexed, web_view_link")
      .order("modified_time", { ascending: false })
      .limit(500);

    setFiles((data || []) as DriveFile[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const toggleFile = (externalId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  };

  const selectAll = () => {
    const selectableFiles = filteredFiles.filter((f) => isIndexable(f.mime_type));
    setSelectedIds(new Set(selectableFiles.map((f) => f.external_id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setOperationResult(null);
  };

  // Determine what actions are available based on selection
  const selectedFiles = files.filter((f) => selectedIds.has(f.external_id));
  const selectedIndexed = selectedFiles.filter((f) => f.is_indexed);
  const selectedNotIndexed = selectedFiles.filter((f) => !f.is_indexed);
  const hasIndexed = selectedIndexed.length > 0;
  const hasNotIndexed = selectedNotIndexed.length > 0;

  const handleIndex = async () => {
    if (selectedIds.size === 0) return;
    setOperating(true);
    setOperationResult(null);

    try {
      const res = await fetch("/api/google-drive/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedIds) }),
      });

      const data = await res.json();
      if (data.success) {
        setOperationResult(data.result);
        setSelectedIds(new Set());
        loadFiles();
      } else {
        setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: data.error || "Request failed" }] });
      }
    } catch {
      setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: "Network error" }] });
    } finally {
      setOperating(false);
    }
  };

  const handleReindex = async () => {
    if (selectedIds.size === 0) return;
    setOperating(true);
    setOperationResult(null);

    try {
      const res = await fetch("/api/google-drive/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedIds), forceReindex: true }),
      });

      const data = await res.json();
      if (data.success) {
        setOperationResult(data.result);
        setSelectedIds(new Set());
        loadFiles();
      } else {
        setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: data.error || "Request failed" }] });
      }
    } catch {
      setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: "Network error" }] });
    } finally {
      setOperating(false);
    }
  };

  const handleUnindex = async () => {
    if (selectedIds.size === 0) return;
    setOperating(true);
    setOperationResult(null);

    try {
      const res = await fetch("/api/google-drive/unindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedIds) }),
      });

      const data = await res.json();
      if (data.success) {
        setOperationResult(data.result);
        setSelectedIds(new Set());
        loadFiles();
      } else {
        setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: data.error || "Request failed" }] });
      }
    } catch {
      setOperationResult({ created: 0, updated: 0, errors: 1, fileStatuses: [{ fileId: "", fileName: "", status: "error", reason: "Network error" }] });
    } finally {
      setOperating(false);
    }
  };

  const isIndexable = (mimeType: string | null): boolean => {
    if (!mimeType) return false;
    return Object.keys(MIME_TYPE_LABELS).includes(mimeType);
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMimeLabel = (mimeType: string | null) => {
    if (!mimeType) return "File";
    return MIME_TYPE_LABELS[mimeType] || mimeType.split("/").pop() || "File";
  };

  // Filter files
  const filteredFiles = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType === "indexed" && !f.is_indexed) return false;
    if (filterType === "not_indexed" && f.is_indexed) return false;
    if (filterType === "docs" && !f.mime_type?.includes("document") && !f.mime_type?.includes("wordprocessing")) return false;
    if (filterType === "sheets" && !f.mime_type?.includes("spreadsheet") && !f.mime_type?.includes("csv")) return false;
    if (filterType === "pdf" && f.mime_type !== "application/pdf") return false;
    return true;
  });

  const indexedCount = files.filter((f) => f.is_indexed).length;

  // Build result summary message
  const resultSummary = (() => {
    if (!operationResult) return null;
    const parts: string[] = [];
    if (operationResult.created > 0) parts.push(`${operationResult.created} indexed`);
    if (operationResult.updated > 0) parts.push(`${operationResult.updated} updated`);
    if (operationResult.errors > 0) parts.push(`${operationResult.errors} error(s)`);
    return parts.join(", ");
  })();

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drive-browser-modal">
        <div className="drive-browser-header">
          <h3>Google Drive Files</h3>
          <div className="drive-browser-stats">
            <span>{files.length} files synced</span>
            <span className="drive-browser-stat-divider">·</span>
            <span>{indexedCount} indexed</span>
          </div>
          <button className="drive-browser-close" onClick={onClose}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Search and filters */}
        <div className="drive-browser-controls">
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="drive-browser-search"
          />
          <div className="drive-browser-filters">
            {["all", "docs", "sheets", "pdf", "indexed", "not_indexed"].map((type) => (
              <button
                key={type}
                className={`drive-filter-pill ${filterType === type ? "drive-filter-pill-active" : ""}`}
                onClick={() => setFilterType(type)}
              >
                {type === "all" ? "All" : type === "docs" ? "Docs" : type === "sheets" ? "Sheets" : type === "pdf" ? "PDFs" : type === "indexed" ? "Indexed" : "Not Indexed"}
              </button>
            ))}
          </div>
        </div>

        {/* File list */}
        <div className="drive-browser-list">
          {loading ? (
            <div className="drive-browser-loading">Loading files...</div>
          ) : filteredFiles.length === 0 ? (
            <div className="drive-browser-empty">
              {files.length === 0
                ? "No files synced yet. Click 'Sync Files' first."
                : "No files match your filters."}
            </div>
          ) : (
            filteredFiles.map((f) => (
              <div
                key={f.id}
                className={`drive-file-row ${selectedIds.has(f.external_id) ? "drive-file-row-selected" : ""} ${f.is_indexed ? "drive-file-row-indexed" : ""}`}
              >
                <label className="drive-file-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(f.external_id)}
                    onChange={() => toggleFile(f.external_id)}
                    disabled={!isIndexable(f.mime_type)}
                  />
                </label>
                <div className="drive-file-info">
                  <span className="drive-file-name">{f.name}</span>
                  <span className="drive-file-meta">
                    {getMimeLabel(f.mime_type)}
                    {f.parent_folder_name && ` · ${f.parent_folder_name}`}
                    {f.size_bytes ? ` · ${formatSize(f.size_bytes)}` : ""}
                    {f.modified_time && ` · ${new Date(f.modified_time).toLocaleDateString()}`}
                  </span>
                </div>
                {f.is_indexed && (
                  <span className="drive-file-indexed-badge">Indexed</span>
                )}
                {!f.is_indexed && !isIndexable(f.mime_type) && (
                  <span className="drive-file-noindex-badge">Not supported</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="drive-browser-footer">
          <div className="drive-browser-selection">
            {selectedIds.size > 0 && (
              <span>{selectedIds.size} file{selectedIds.size !== 1 ? "s" : ""} selected</span>
            )}
            <button className="btn btn-sm" onClick={selectAll}>Select All</button>
            <button className="btn btn-sm" onClick={clearSelection}>Clear</button>
          </div>
          <div className="drive-browser-actions">
            {operationResult && (
              <div className="drive-index-result-container">
                {resultSummary && (
                  <span className="drive-index-result">{resultSummary}</span>
                )}
                {operationResult.fileStatuses && operationResult.fileStatuses.some(s => s.status === "error") && (
                  <div className="drive-index-errors">
                    {operationResult.fileStatuses.filter(s => s.status === "error").map((s, i) => (
                      <div key={i} className="drive-index-error-row">
                        <span className="drive-index-error-file">{s.fileName || "Unknown file"}</span>
                        <span className="drive-index-error-reason">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Remove from Index — only when indexed files are selected */}
            {hasIndexed && (
              <button
                className="btn btn-sm drive-btn-unindex"
                disabled={operating}
                onClick={handleUnindex}
              >
                {operating ? "Removing..." : `Remove ${selectedIndexed.length} from Index`}
              </button>
            )}

            {/* Re-index — when indexed files are selected */}
            {hasIndexed && (
              <button
                className="btn btn-sm drive-btn-reindex"
                disabled={operating}
                onClick={handleReindex}
              >
                {operating ? "Re-indexing..." : `Re-index ${hasNotIndexed ? "All" : selectedIndexed.length}`}
              </button>
            )}

            {/* Index — when non-indexed files are selected */}
            {hasNotIndexed && (
              <button
                className="btn btn-primary btn-sm"
                disabled={operating}
                onClick={hasIndexed ? handleReindex : handleIndex}
              >
                {operating
                  ? "Indexing..."
                  : `Index ${selectedNotIndexed.length} File${selectedNotIndexed.length !== 1 ? "s" : ""}`}
              </button>
            )}

            {/* Fallback when nothing selected */}
            {!hasIndexed && !hasNotIndexed && (
              <button className="btn btn-primary btn-sm" disabled>
                Select files to index
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
