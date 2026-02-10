"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { WorkflowData } from "@/lib/types/database";

/* ── Version entry ────────────────────────────────────── */

interface VersionEntry {
  data: WorkflowData;
  timestamp: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
}

/* ── Storage helpers ──────────────────────────────────── */

function storageKey(projectId: string) {
  return `wf-history-${projectId}`;
}

function loadHistory(projectId: string): VersionEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(projectId: string, history: VersionEntry[]) {
  try {
    // Keep last 20 versions, capped at ~2MB per project
    const capped = history.slice(0, 20);
    localStorage.setItem(storageKey(projectId), JSON.stringify(capped));
  } catch {
    // localStorage full — drop oldest
    const trimmed = history.slice(0, 5);
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

/* ── Public API ───────────────────────────────────────── */

export function snapshotWorkflow(projectId: string, data: WorkflowData, label: string) {
  if (!data.nodes.length) return; // don't snapshot empty flows
  const history = loadHistory(projectId);
  history.unshift({
    data: structuredClone(data),
    timestamp: new Date().toISOString(),
    label,
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
  });
  saveHistory(projectId, history);
}

/* ── History panel component ──────────────────────────── */

interface Props {
  projectId: string;
  currentData: WorkflowData;
  onRestore: (data: WorkflowData) => void;
  onClose: () => void;
}

export default function WorkflowHistory({ projectId, currentData, onRestore, onClose }: Props) {
  const [history, setHistory] = useState<VersionEntry[]>([]);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  useEffect(() => {
    setHistory(loadHistory(projectId));
  }, [projectId]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSaveSnapshot = useCallback(() => {
    snapshotWorkflow(projectId, currentData, "Manual save");
    setHistory(loadHistory(projectId));
  }, [projectId, currentData]);

  const handleRestore = useCallback((idx: number) => {
    const entry = history[idx];
    if (!entry) return;
    // Snapshot current before restoring
    snapshotWorkflow(projectId, currentData, "Before restore");
    onRestore(entry.data);
    onClose();
  }, [history, projectId, currentData, onRestore, onClose]);

  const handleDelete = useCallback((idx: number) => {
    const updated = history.filter((_, i) => i !== idx);
    saveHistory(projectId, updated);
    setHistory(updated);
    if (previewIdx === idx) setPreviewIdx(null);
  }, [history, projectId, previewIdx]);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const modal = (
    <div className="wf-hist-overlay" onClick={onClose}>
      <div className="wf-hist-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wf-hist-header">
          <div className="wf-hist-header-left">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="9" cy="9" r="7" />
              <path d="M9 5v4l2.5 1.5" />
            </svg>
            <div>
              <h2 className="wf-hist-title">Version History</h2>
              <p className="wf-hist-subtitle">{history.length} saved version{history.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button className="wf-hist-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Save current */}
        <button className="wf-hist-save-btn" onClick={handleSaveSnapshot}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M7 1v12M1 7h12" />
          </svg>
          Save current version
        </button>

        {/* Version list */}
        <div className="wf-hist-list">
          {history.length === 0 ? (
            <div className="wf-hist-empty">
              <p>No versions saved yet.</p>
              <p className="wf-hist-empty-sub">Versions are automatically saved before AI generates a new flow. You can also save manually using the button above.</p>
            </div>
          ) : (
            history.map((entry, idx) => (
              <div
                key={entry.timestamp}
                className={`wf-hist-item${previewIdx === idx ? " wf-hist-item-active" : ""}`}
                onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)}
              >
                <div className="wf-hist-item-main">
                  <div className="wf-hist-item-label">{entry.label}</div>
                  <div className="wf-hist-item-meta">
                    <span>{formatTime(entry.timestamp)}</span>
                    <span className="wf-hist-item-sep">&middot;</span>
                    <span>{entry.nodeCount} nodes</span>
                    <span className="wf-hist-item-sep">&middot;</span>
                    <span>{entry.edgeCount} edges</span>
                  </div>
                </div>

                {previewIdx === idx && (
                  <div className="wf-hist-item-actions">
                    <button className="wf-hist-restore-btn" onClick={(e) => { e.stopPropagation(); handleRestore(idx); }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                        <path d="M1 4.5h5.5v-4M1 4.5a5 5 0 109 1" />
                      </svg>
                      Restore this version
                    </button>
                    <button className="wf-hist-delete-btn" onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                        <path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M9.5 3v6.5a1 1 0 01-1 1h-5a1 1 0 01-1-1V3" />
                      </svg>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
