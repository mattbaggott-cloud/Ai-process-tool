"use client";

import React, { useState, useRef, useCallback } from "react";
import { useFiles, formatFileSize, getFileExtension, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import type { UploadedFile } from "@/context/FileContext";

/* ══════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════ */

type Category = "Note" | "Document" | "Template" | "Reference";

interface LibraryItem {
  id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ───────────────────────────────────────────── */

let counter = 0;
const uid = () => `lib-${++counter}-${Date.now()}`;

const now = () => new Date().toISOString();

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const categories: Category[] = ["Note", "Document", "Template", "Reference"];

const categoryStyles: Record<Category, { bg: string; color: string }> = {
  Note:      { bg: "#eff6ff", color: "#2563eb" },
  Document:  { bg: "#f0fdf4", color: "#16a34a" },
  Template:  { bg: "#fef3c7", color: "#92400e" },
  Reference: { bg: "#f5f3ff", color: "#7c3aed" },
};

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | Category>("All");

  /* ── Form state ── */
  const blankItem = { title: "", content: "", category: "Note" as Category, tags: "" };
  const [form, setForm] = useState(blankItem);

  /* ── File upload (library = permanent platform storage) ── */
  const { libraryFiles, addLibraryFiles, removeLibraryFile } = useFiles();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const validateAndAdd = useCallback(async (fileList: FileList | File[]) => {
    setUploadError("");
    const valid: File[] = [];
    const files = Array.from(fileList);
    for (const f of files) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setUploadError(`Unsupported file type: .${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        setUploadError(`File too large: ${f.name}. Max 10 MB.`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) await addLibraryFiles(valid);
  }, [addLibraryFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      await validateAndAdd(e.dataTransfer.files);
    }
  }, [validateAndAdd]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await validateAndAdd(e.target.files);
      e.target.value = "";
    }
  }, [validateAndAdd]);

  const fmtUploadDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  /* ── Search files ── */
  const matchesFileSearch = (f: UploadedFile) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return f.name.toLowerCase().includes(q);
  };

  const filteredFiles = libraryFiles.filter(matchesFileSearch);

  /* ── CRUD ── */
  const addItem = () => {
    if (!form.title.trim()) return;
    const ts = now();
    const item: LibraryItem = {
      id: uid(),
      title: form.title,
      content: form.content,
      category: form.category,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: ts,
      updatedAt: ts,
    };
    setItems([item, ...items]);
    setForm(blankItem);
    setShowForm(false);
  };

  const updateItem = (id: string) => {
    setItems(items.map((item) =>
      item.id === id
        ? {
            ...item,
            title: form.title,
            content: form.content,
            category: form.category,
            tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
            updatedAt: now(),
          }
        : item
    ));
    setEditingId(null);
    setForm(blankItem);
  };

  const deleteItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
    if (editingId === id) { setEditingId(null); setForm(blankItem); }
    if (viewingId === id) setViewingId(null);
  };

  const startEdit = (item: LibraryItem) => {
    setEditingId(item.id);
    setViewingId(null);
    setForm({
      title: item.title,
      content: item.content,
      category: item.category,
      tags: item.tags.join(", "),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(blankItem);
  };

  /* ── Search & filter notes ── */
  const matchesSearch = (item: LibraryItem) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q))
    );
  };

  const filtered = items
    .filter((item) => filter === "All" || item.category === filter)
    .filter(matchesSearch);

  const countFor = (cat: Category) => items.filter((i) => i.category === cat).length;

  const filters: { label: string; value: "All" | Category; count: number }[] = [
    { label: "All", value: "All", count: items.length },
    ...categories.map((c) => ({ label: c + "s", value: c as "All" | Category, count: countFor(c) })),
  ];

  /* ── Viewing item ── */
  const viewItem = viewingId ? items.find((i) => i.id === viewingId) : null;

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Library</h1>
          <p className="canvas-subtitle">Platform storage for files, notes, and documents. AI has context of everything here.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(!showForm); setEditingId(null); setViewingId(null); setForm(blankItem); }}
        >
          {showForm ? "Cancel" : "+ New Item"}
        </button>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">

        {/* ── Add form ── */}
        {showForm && (
          <div className="inline-form" style={{ marginBottom: 24 }}>
            <input
              className="input"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
            <textarea
              className="input textarea"
              rows={4}
              placeholder="Write your note or paste content here..."
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
            <div className="inline-form-row">
              <select
                className="select"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                className="input"
                placeholder="Tags (comma-separated, e.g. sales, pipeline)"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>
            <div className="inline-form-actions">
              <button className="btn btn-primary btn-sm" onClick={addItem}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setForm(blankItem); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Search ── */}
        <input
          className="input"
          placeholder="Search files, notes, and documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* ── Compact upload drop zone ── */}
        <div
          className={`upload-zone-compact ${isDragging ? "upload-zone-compact-active" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={handleFileInput}
            style={{ display: "none" }}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="upload-zone-compact-icon">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="upload-zone-compact-text">
            {isDragging ? "Drop files here" : "Drop files here or"}
          </span>
          {!isDragging && <span className="upload-browse-btn">browse</span>}
          <span className="upload-zone-compact-hint">PDF, CSV, TXT, MD, JSON, TSV</span>
        </div>

        {uploadError && (
          <div className="upload-error" style={{ marginTop: 8 }}>{uploadError}</div>
        )}

        {/* ── Uploaded files table ── */}
        {filteredFiles.length > 0 && (
          <div className="upload-file-list" style={{ marginTop: 12, marginBottom: 20, maxHeight: 320, overflowY: "auto" }}>
            {filteredFiles.map((f) => {
              const ext = getFileExtension(f.name);
              return (
                <div key={f.id} className="upload-file-row">
                  <div className="upload-file-icon">
                    {ext === "PDF" ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    ) : ext === "CSV" || ext === "TSV" ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="15" y1="3" x2="15" y2="21" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    )}
                  </div>
                  <span className="upload-file-name" title={f.name}>{f.name}</span>
                  <span className="upload-file-type-badge">{ext}</span>
                  <span className="upload-file-size">{formatFileSize(f.size)}</span>
                  <span className="upload-file-date">{fmtUploadDate(f.addedAt)}</span>
                  {f.textContent !== null && (
                    <span className="upload-file-status" title="Text extracted for AI context">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                  <button
                    className="item-delete"
                    onClick={() => removeLibraryFile(f.id)}
                    title="Remove file"
                    style={{ opacity: 1 }}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Filter pills ── */}
        {items.length > 0 && (
          <div className="pill-group" style={{ marginBottom: 20, flexWrap: "wrap" }}>
            {filters.map((f) => (
              <button
                key={f.value}
                className={`pill ${filter === f.value ? "pill-active" : "pill-inactive"}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {f.count > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>{f.count}</span>}
              </button>
            ))}
          </div>
        )}

        {/* ── Stats ── */}
        {items.length > 0 && (
          <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(4, 1fr)" }}>
            {categories.map((c) => (
              <div key={c} className="stat-box">
                <div className="stat-value" style={{ color: categoryStyles[c].color }}>{countFor(c)}</div>
                <div className="stat-label">{c}s</div>
              </div>
            ))}
          </div>
        )}

        {/* ── View detail panel ── */}
        {viewItem && editingId !== viewItem.id && (
          <div className="lib-detail" style={{ marginBottom: 24 }}>
            <div className="lib-detail-header">
              <div>
                <span
                  className="lib-category-badge"
                  style={{ background: categoryStyles[viewItem.category].bg, color: categoryStyles[viewItem.category].color }}
                >
                  {viewItem.category}
                </span>
                <h3 className="lib-detail-title">{viewItem.title}</h3>
                <div className="lib-detail-meta">
                  Created {fmtDate(viewItem.createdAt)}
                  {viewItem.updatedAt !== viewItem.createdAt && ` · Updated ${fmtDate(viewItem.updatedAt)}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(viewItem)}>Edit</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setViewingId(null)}>Close</button>
              </div>
            </div>
            {viewItem.content && <div className="lib-detail-content">{viewItem.content}</div>}
            {viewItem.tags.length > 0 && (
              <div className="lib-detail-tags">
                {viewItem.tags.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
            )}
          </div>
        )}

        {/* ── Note cards ── */}
        {filtered.length > 0 && (
          <div className="lib-grid">
            {filtered.map((item) => {
              const isEditing = editingId === item.id;
              const cs = categoryStyles[item.category];

              return (
                <div key={item.id} className={`lib-card ${viewingId === item.id ? "lib-card-active" : ""}`}>
                  {isEditing ? (
                    /* ── Edit mode ── */
                    <div className="inline-form" style={{ border: "none", padding: 0, margin: 0, background: "transparent" }}>
                      <input
                        className="input"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        autoFocus
                      />
                      <textarea
                        className="input textarea"
                        rows={3}
                        value={form.content}
                        onChange={(e) => setForm({ ...form, content: e.target.value })}
                      />
                      <div className="inline-form-row">
                        <select
                          className="select"
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                        >
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          className="input"
                          placeholder="Tags (comma-separated)"
                          value={form.tags}
                          onChange={(e) => setForm({ ...form, tags: e.target.value })}
                        />
                      </div>
                      <div className="inline-form-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => updateItem(item.id)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display mode ── */
                    <>
                      <div className="lib-card-body" onClick={() => setViewingId(viewingId === item.id ? null : item.id)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span className="lib-category-badge" style={{ background: cs.bg, color: cs.color }}>
                            {item.category}
                          </span>
                          <span className="lib-card-date">{fmtDate(item.updatedAt)}</span>
                        </div>
                        <div className="lib-card-title">{item.title}</div>
                        {item.content && (
                          <div className="lib-card-preview">
                            {item.content.length > 120 ? item.content.slice(0, 120) + "..." : item.content}
                          </div>
                        )}
                        {item.tags.length > 0 && (
                          <div className="lib-card-tags">
                            {item.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                          </div>
                        )}
                      </div>
                      <div className="lib-card-actions">
                        <button className="text-link" onClick={() => startEdit(item)}>Edit</button>
                        <button className="item-delete" onClick={() => deleteItem(item.id)} title="Delete" style={{ opacity: 1 }}>&times;</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
