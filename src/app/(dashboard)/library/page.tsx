"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFiles, formatFileSize, getFileExtension, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import type { UploadedFile } from "@/context/FileContext";
import type { Category } from "@/lib/types/database";

/* ── Helpers ───────────────────────────────────────────── */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const categories: Category[] = ["Note", "Document", "Template", "Reference"];

const categoryStyles: Record<Category, { bg: string; color: string }> = {
  Note:      { bg: "#eff6ff", color: "#2563eb" },
  Document:  { bg: "#f0fdf4", color: "#16a34a" },
  Template:  { bg: "#fef3c7", color: "#92400e" },
  Reference: { bg: "#f5f3ff", color: "#7c3aed" },
};

/* ── Types (local view of database row) ───────────────── */

interface LibItem {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function LibraryPage() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const supabase = createClient();

  const [items, setItems] = useState<LibItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | Category | "File">("All");

  /* ── Form state ── */
  const blankItem = { title: "", content: "", category: "Note" as Category, tags: "" };
  const [form, setForm] = useState(blankItem);

  /* ── File upload (library = permanent platform storage) ── */
  const { libraryFiles, addLibraryFiles, removeLibraryFile, libraryLoading } = useFiles();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Load notes from Supabase ── */
  const loadItems = useCallback(() => {
    if (!user) { setItemsLoading(false); return; }

    setItemsLoading(true);
    supabase
      .from("library_items")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (data) setItems(data as LibItem[]);
        setItemsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { loadItems(); }, [loadItems]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadItems();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadItems]);

  /* ── Drag & drop handlers ── */

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

  /* ── CRUD (Supabase-backed) ── */

  const addItem = async () => {
    if (!form.title.trim() || !user) return;
    const newItem = {
      user_id: user.id,
      org_id: orgId,
      title: form.title,
      content: form.content,
      category: form.category,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const { data, error } = await supabase
      .from("library_items")
      .insert(newItem)
      .select()
      .single();

    if (data && !error) {
      setItems([data as LibItem, ...items]);
      setForm(blankItem);
      setShowForm(false);
    }
  };

  const updateItem = async (id: string) => {
    const updates = {
      title: form.title,
      content: form.content,
      category: form.category,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("library_items")
      .update(updates)
      .eq("id", id);

    if (!error) {
      setItems(
        items.map((item) =>
          item.id === id ? { ...item, ...updates } : item
        )
      );
      setEditingId(null);
      setForm(blankItem);
    }
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase
      .from("library_items")
      .delete()
      .eq("id", id);

    if (!error) {
      setItems(items.filter((item) => item.id !== id));
      if (editingId === id) { setEditingId(null); setForm(blankItem); }
      if (viewingId === id) setViewingId(null);
    }
  };

  const startEdit = (item: LibItem) => {
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
  const matchesSearch = (item: LibItem) => {
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

  const totalCount = items.length + libraryFiles.length;
  const fileCount = libraryFiles.filter(matchesFileSearch).length;

  const filters: { label: string; value: "All" | Category | "File"; count: number }[] = [
    { label: "All", value: "All", count: totalCount },
    ...categories.map((c) => ({ label: c + "s", value: c as "All" | Category | "File", count: countFor(c) })),
    { label: "Files", value: "File" as "All" | Category | "File", count: libraryFiles.length },
  ];

  /* ── Viewing item ── */
  const viewItem = viewingId ? items.find((i) => i.id === viewingId) : null;

  /* ── Loading state ── */
  const isLoading = itemsLoading || libraryLoading;

  /* Should we show files in the card grid? */
  const showFiles = filter === "All" || filter === "File";
  const showNotes = filter !== "File";

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

        {/* ── Loading indicator ── */}
        {isLoading && (
          <div style={{ textAlign: "center", padding: 24, color: "#6b7280", fontSize: 14 }}>
            Loading library...
          </div>
        )}

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

        {/* 1. Filter tabs */}
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

        {/* 2. Stats cards */}
        <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(5, 1fr)" }}>
          {categories.map((c) => (
            <div key={c} className="stat-box">
              <div className="stat-value" style={{ color: categoryStyles[c].color }}>{countFor(c)}</div>
              <div className="stat-label">{c}s</div>
            </div>
          ))}
          <div className="stat-box">
            <div className="stat-value" style={{ color: "#0891b2" }}>{libraryFiles.length}</div>
            <div className="stat-label">Files</div>
          </div>
        </div>

        {/* 3. Search bar */}
        <input
          className="input"
          placeholder="Search files, notes, and documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* 4. Drop zone */}
        <div
          className={`upload-zone-compact ${isDragging ? "upload-zone-compact-active" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ marginBottom: 20 }}
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
          <div className="upload-error" style={{ marginBottom: 16 }}>{uploadError}</div>
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
                  Created {fmtDate(viewItem.created_at)}
                  {viewItem.updated_at !== viewItem.created_at && ` · Updated ${fmtDate(viewItem.updated_at)}`}
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

        {/* 5. Cards grid — files + notes together */}
        <div className="lib-grid">

          {/* ── File cards ── */}
          {showFiles && filteredFiles.map((f) => {
            const ext = getFileExtension(f.name);
            return (
              <div key={`file-${f.id}`} className="lib-card">
                <div className="lib-card-body">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="lib-category-badge" style={{ background: "#ecfeff", color: "#0891b2" }}>
                      {ext}
                    </span>
                    <span className="lib-card-date">{fmtDate(f.addedAt)}</span>
                  </div>
                  <div className="lib-card-title">{f.name}</div>
                  <div className="lib-card-preview" style={{ color: "#6b7280" }}>
                    {formatFileSize(f.size)}
                    {f.textContent !== null && " · Text extracted for AI context"}
                  </div>
                </div>
                <div className="lib-card-actions">
                  <span className="upload-file-type-badge">{ext}</span>
                  <button className="item-delete" onClick={() => removeLibraryFile(f.id)} title="Remove file" style={{ opacity: 1 }}>&times;</button>
                </div>
              </div>
            );
          })}

          {/* ── Note cards ── */}
          {showNotes && filtered.map((item) => {
            const isEditing = editingId === item.id;
            const cs = categoryStyles[item.category];

            return (
              <div key={item.id} className={`lib-card ${viewingId === item.id ? "lib-card-active" : ""}`}>
                {isEditing ? (
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
                  <>
                    <div className="lib-card-body" onClick={() => setViewingId(viewingId === item.id ? null : item.id)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span className="lib-category-badge" style={{ background: cs.bg, color: cs.color }}>
                          {item.category}
                        </span>
                        <span className="lib-card-date">{fmtDate(item.updated_at)}</span>
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
      </div>
    </>
  );
}
