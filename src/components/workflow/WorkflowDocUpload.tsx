"use client";

import React, { useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/* ── Types ────────────────────────────────────────────── */

interface Props {
  projectName: string;
  onGenerate: (docText: string, docName: string) => void;
  onClose: () => void;
}

const ACCEPTED = ".pdf,.csv,.txt,.md,.json,.tsv";
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Component ────────────────────────────────────────── */

export default function WorkflowDocUpload({ projectName, onGenerate, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── File selection handler ── */
  const handleFile = useCallback(async (f: File) => {
    setError(null);
    setExtractedText(null);

    if (f.size > MAX_SIZE) {
      setError("File too large (10 MB max)");
      return;
    }

    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "csv", "txt", "md", "json", "tsv"].includes(ext)) {
      setError("Unsupported file type. Use PDF, CSV, TXT, MD, JSON, or TSV.");
      return;
    }

    setFile(f);
    setExtracting(true);

    try {
      let text = "";
      if (ext === "pdf") {
        /* Server-side extraction for PDFs */
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/extract-text", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Failed to extract PDF text");
        const data = await res.json();
        text = data.text || "";
      } else {
        /* Client-side for text files */
        text = await f.text();
      }

      if (!text.trim()) {
        setError("Could not extract text from this file. The file may be empty or image-based.");
        setExtracting(false);
        return;
      }

      setExtractedText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setExtracting(false);
    }
  }, []);

  /* ── Drop zone handlers ── */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  /* ── Generate button ── */
  const handleGenerate = useCallback(() => {
    if (!file || !extractedText) return;
    setGenerating(true);
    onGenerate(extractedText, file.name);
  }, [file, extractedText, onGenerate]);

  /* ── Escape to close ── */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const modal = (
    <div className="wf-doc-overlay" onClick={onClose}>
      <div className="wf-doc-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wf-doc-header">
          <div className="wf-doc-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round">
              <path d="M11 2H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7l-5-5z" />
              <path d="M11 2v5h5" />
              <path d="M7 10h6M7 13h4" />
            </svg>
            <div>
              <h2 className="wf-doc-title">Generate Flow from Document</h2>
              <p className="wf-doc-subtitle">Upload an SOP, process doc, or playbook to auto-generate a workflow</p>
            </div>
          </div>
          <button className="wf-doc-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Target project */}
        <div className="wf-doc-project">
          <span className="wf-doc-project-label">Project:</span>
          <span className="wf-doc-project-name">{projectName}</span>
        </div>

        {/* Drop zone or file preview */}
        {!file ? (
          <div
            className={`wf-doc-dropzone${dragOver ? " wf-doc-dropzone-active" : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="wf-doc-dropzone-icon">
              <rect x="4" y="4" width="32" height="32" rx="8" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
              <path d="M20 13v14M13 20h14" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="wf-doc-dropzone-text">
              <strong>Drop a file here</strong> or click to browse
            </p>
            <p className="wf-doc-dropzone-hint">
              PDF, TXT, CSV, MD, JSON, TSV &middot; 10 MB max
            </p>
          </div>
        ) : (
          <div className="wf-doc-file-preview">
            <div className="wf-doc-file-info">
              <div className="wf-doc-file-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
                  <path d="M14 2v6h6" />
                </svg>
              </div>
              <div>
                <p className="wf-doc-file-name">{file.name}</p>
                <p className="wf-doc-file-size">{formatSize(file.size)}</p>
              </div>
              <button
                className="wf-doc-file-remove"
                onClick={() => { setFile(null); setExtractedText(null); setError(null); }}
                title="Remove file"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M4 4l6 6M10 4l-6 6" />
                </svg>
              </button>
            </div>

            {/* Extraction status */}
            {extracting && (
              <div className="wf-doc-status wf-doc-status-extracting">
                <div className="wf-doc-spinner" />
                <span>Extracting text from document…</span>
              </div>
            )}

            {error && (
              <div className="wf-doc-status wf-doc-status-error">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4.5v3M7 9.5v0" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {extractedText && !extracting && (
              <div className="wf-doc-status wf-doc-status-success">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M4.5 7l2 2 3.5-3.5" />
                </svg>
                <span>{extractedText.length.toLocaleString()} characters extracted</span>
              </div>
            )}

            {/* Text preview */}
            {extractedText && !extracting && (
              <div className="wf-doc-text-preview">
                <p className="wf-doc-text-preview-label">Document preview:</p>
                <pre className="wf-doc-text-content">
                  {extractedText.slice(0, 1500)}
                  {extractedText.length > 1500 ? "\n\n…(truncated)" : ""}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="wf-doc-actions">
          <button className="wf-doc-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`wf-doc-generate-btn${!extractedText || extracting || generating ? " wf-doc-btn-disabled" : ""}`}
            onClick={handleGenerate}
            disabled={!extractedText || extracting || generating}
          >
            {generating ? (
              <>
                <div className="wf-doc-spinner wf-doc-spinner-white" />
                Generating…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M7 1l1.5 3.5L12 6l-3.5 1.5L7 11 5.5 7.5 2 6l3.5-1.5Z" />
                </svg>
                Generate Workflow
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
