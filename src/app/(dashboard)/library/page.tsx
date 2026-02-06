"use client";

import React, { useState } from "react";

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

  /* ── Search & filter ── */
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
          <p className="canvas-subtitle">Searchable archive of notes, documents, and references</p>
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
          placeholder="Search by title, content, or tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />

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

        {/* ── Item list ── */}
        {filtered.length === 0 && !showForm ? (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 16px" }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <h3>{items.length === 0 ? "Library is empty" : "No matching items"}</h3>
            <p>{items.length === 0
              ? "Click \"+ New Item\" to save your first note, document, or reference."
              : "Try adjusting your search or filter."}</p>
          </div>
        ) : (
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
