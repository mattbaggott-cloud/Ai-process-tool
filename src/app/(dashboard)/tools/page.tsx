"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import type { ToolStatus } from "@/lib/types/database";

/* ══════════════════════════════════════════════════════════
   LOCAL TYPES
   ══════════════════════════════════════════════════════════ */

interface CatalogTool {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  key_features: string[];
  pricing: string;
  best_for: string;
  integrations: string[];
  pros: string[];
  cons: string[];
  website: string;
}

interface StackTool {
  id: string;
  catalog_id: string | null;
  name: string;
  description: string;
  category: string;
  teams: string[];
  team_usage: Record<string, string>;
  status: ToolStatus;
  created_at: string;
}

/* ══════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════ */

const CATEGORIES = [
  "GTM", "Product Management", "Engineering", "AI/ML",
  "Operations", "Data", "Security", "Communication",
];

/* ══════════════════════════════════════════════════════════
   CSV PARSER  (lightweight, handles quoted fields)
   ══════════════════════════════════════════════════════════ */

function parseCSV(text: string): Record<string, string>[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length < 2) return [];

  /* Parse header */
  const headers = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));

  /* Parse rows */
  return lines.slice(1).map((line) => {
    const vals = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function ToolsPage() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const supabase = createClient();

  /* ── Tab state ── */
  const [tab, setTab] = useState<"stack" | "catalog">("stack");

  /* ── Data ── */
  const [stackTools, setStackTools] = useState<StackTool[]>([]);
  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── UI state ── */
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── Stack form ── */
  const blankStack = { name: "", description: "", category: "GTM", teams: "" as string, teamUsage: "" as string, status: "Active" as ToolStatus };
  const [stackForm, setStackForm] = useState(blankStack);

  /* ── CSV import ── */
  const [csvRows, setCsvRows] = useState<Record<string, string>[] | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Teams list (for tag picker) ── */
  const [teamNames, setTeamNames] = useState<string[]>([]);

  /* ══════════════════════════════════════════════════════════
     DATA LOADING
     ══════════════════════════════════════════════════════════ */

  const loadData = useCallback(async () => {
    if (!user) return;

    const [stackRes, catalogRes, teamsRes] = await Promise.all([
      supabase.from("user_stack_tools").select("*").order("created_at", { ascending: false }),
      supabase.from("tool_catalog").select("*").order("name", { ascending: true }),
      supabase.from("teams").select("name").order("name"),
    ]);

    setStackTools(
      (stackRes.data ?? []).map((r) => ({
        id: r.id,
        catalog_id: r.catalog_id,
        name: r.name,
        description: r.description ?? "",
        category: r.category ?? "",
        teams: r.teams ?? [],
        team_usage: (r.team_usage as Record<string, string>) ?? {},
        status: r.status ?? "Active",
        created_at: r.created_at,
      }))
    );

    setCatalogTools(
      (catalogRes.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category ?? "",
        subcategory: r.subcategory ?? "",
        description: r.description ?? "",
        key_features: r.key_features ?? [],
        pricing: r.pricing ?? "",
        best_for: r.best_for ?? "",
        integrations: r.integrations ?? [],
        pros: r.pros ?? [],
        cons: r.cons ?? [],
        website: r.website ?? "",
      }))
    );

    setTeamNames((teamsRes.data ?? []).map((t) => t.name));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadData]);

  /* ══════════════════════════════════════════════════════════
     STACK CRUD
     ══════════════════════════════════════════════════════════ */

  const addStackTool = async () => {
    if (!stackForm.name.trim() || !user) return;

    const teams = stackForm.teams.split(",").map((t) => t.trim()).filter(Boolean);
    const teamUsageObj: Record<string, string> = {};
    if (stackForm.teamUsage.trim()) {
      stackForm.teamUsage.split(",").forEach((pair) => {
        const [team, usage] = pair.split(":").map((s) => s.trim());
        if (team && usage) teamUsageObj[team] = usage;
      });
    }

    const { data: row, error } = await supabase
      .from("user_stack_tools")
      .insert({
        user_id: user.id,
        org_id: orgId,
        name: stackForm.name,
        description: stackForm.description,
        category: stackForm.category,
        teams,
        team_usage: teamUsageObj,
        status: stackForm.status,
      })
      .select()
      .single();

    if (error || !row) return;

    setStackTools((prev) => [{
      id: row.id,
      catalog_id: row.catalog_id,
      name: row.name,
      description: row.description ?? "",
      category: row.category ?? "",
      teams: row.teams ?? [],
      team_usage: (row.team_usage as Record<string, string>) ?? {},
      status: row.status ?? "Active",
      created_at: row.created_at,
    }, ...prev]);
    setStackForm(blankStack);
    setShowForm(false);
  };

  const removeStackTool = async (id: string) => {
    await supabase.from("user_stack_tools").delete().eq("id", id);
    setStackTools((prev) => prev.filter((t) => t.id !== id));
  };

  const addCatalogToStack = async (cat: CatalogTool) => {
    if (!user) return;
    /* Check if already in stack */
    const exists = stackTools.find((s) => s.name.toLowerCase() === cat.name.toLowerCase());
    if (exists) return;

    const { data: row, error } = await supabase
      .from("user_stack_tools")
      .insert({
        user_id: user.id,
        org_id: orgId,
        catalog_id: cat.id,
        name: cat.name,
        description: cat.description,
        category: cat.category,
        teams: [],
        team_usage: {},
        status: "Evaluating",
      })
      .select()
      .single();

    if (error || !row) return;

    setStackTools((prev) => [{
      id: row.id,
      catalog_id: row.catalog_id,
      name: row.name,
      description: row.description ?? "",
      category: row.category ?? "",
      teams: row.teams ?? [],
      team_usage: (row.team_usage as Record<string, string>) ?? {},
      status: row.status ?? "Evaluating",
      created_at: row.created_at,
    }, ...prev]);
  };

  /* ══════════════════════════════════════════════════════════
     CSV / FILE IMPORT
     ══════════════════════════════════════════════════════════ */

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (file.name.endsWith(".csv")) {
        const rows = parseCSV(text);
        if (rows.length > 0) setCsvRows(rows);
      } else {
        /* Plain text / other — try to parse as line-per-tool */
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const rows = lines.map((line) => ({ name: line }));
        if (rows.length > 0) setCsvRows(rows);
      }
    };
    reader.readAsText(file);
  };

  const importToStack = async () => {
    if (!csvRows || !user) return;
    setCsvImporting(true);

    const rows = csvRows.map((r) => ({
      user_id: user.id,
      org_id: orgId,
      name: r.name ?? "",
      description: r.description ?? "",
      category: r.category ?? "",
      teams: r.teams ? r.teams.split("|").map((t) => t.trim()).filter(Boolean) : [],
      team_usage: {},
      status: r.status ?? "Active",
    })).filter((r) => r.name);

    /* Insert in batches of 50 */
    for (let i = 0; i < rows.length; i += 50) {
      await supabase.from("user_stack_tools").insert(rows.slice(i, i + 50));
    }

    setCsvRows(null);
    setCsvImporting(false);
    loadData();
  };


  /* ══════════════════════════════════════════════════════════
     FILTERING
     ══════════════════════════════════════════════════════════ */

  const filterTools = <T extends { name: string; category: string; description?: string }>(tools: T[]): T[] => {
    let result = tools;
    if (catFilter !== "All") result = result.filter((t) => t.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  };

  const filteredStack = filterTools(stackTools);
  const filteredCatalog = filterTools(catalogTools);

  /* ── Stats ── */
  const stackActive = stackTools.filter((t) => t.status === "Active").length;
  const stackEval = stackTools.filter((t) => t.status === "Evaluating").length;
  const stackDep = stackTools.filter((t) => t.status === "Deprecated").length;

  /* ── Collect all categories actually in use ── */
  const usedCategories = Array.from(
    new Set([
      ...stackTools.map((t) => t.category),
      ...catalogTools.map((t) => t.category),
    ])
  ).filter(Boolean).sort();
  const allCatOptions = Array.from(new Set([...CATEGORIES, ...usedCategories])).sort();

  /* ── Loading ── */
  if (loading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Tools</h1>
          <p className="canvas-subtitle">Manage your tech stack and explore the tool catalog</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state"><p>Loading tools...</p></div>
        </div>
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Tools</h1>
          <p className="canvas-subtitle">Manage your tech stack and explore the tool catalog</p>
        </div>
        {tab === "stack" && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Add Tool"}
          </button>
        )}
      </div>

      <div className="canvas-content">
        {/* ─── Tabs ─── */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #e5e7eb" }}>
          {(["stack", "catalog"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setCatFilter("All"); setSearch(""); }}
              style={{
                padding: "10px 24px",
                fontWeight: 600,
                fontSize: 14,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: tab === t ? "#2563eb" : "#6b7280",
                borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -2,
              }}
            >
              {t === "stack" ? `My Tech Stack (${stackTools.length})` : `Tool Catalog (${catalogTools.length})`}
            </button>
          ))}
        </div>

        {/* ─── Search + Filter ─── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <div className="pill-group" style={{ flexWrap: "wrap" }}>
            <button
              className={`pill ${catFilter === "All" ? "pill-active" : "pill-inactive"}`}
              onClick={() => setCatFilter("All")}
            >All</button>
            {allCatOptions.map((c) => (
              <button
                key={c}
                className={`pill ${catFilter === c ? "pill-active" : "pill-inactive"}`}
                onClick={() => setCatFilter(c)}
              >{c}</button>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════
           TAB 1: MY TECH STACK
           ═══════════════════════════════════════════ */}
        {tab === "stack" && (
          <>
            {/* Stats */}
            {stackTools.length > 0 && (
              <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="stat-box">
                  <div className="stat-value">{stackTools.length}</div>
                  <div className="stat-label">Total</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value" style={{ color: "#16a34a" }}>{stackActive}</div>
                  <div className="stat-label">Active</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value" style={{ color: "#92400e" }}>{stackEval}</div>
                  <div className="stat-label">Evaluating</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value" style={{ color: "#6b7280" }}>{stackDep}</div>
                  <div className="stat-label">Deprecated</div>
                </div>
              </div>
            )}

            {/* Add Tool Form */}
            {showForm && (
              <div className="inline-form" style={{ marginBottom: 24 }}>
                <input
                  className="input"
                  placeholder="Tool name (e.g. HubSpot)"
                  value={stackForm.name}
                  onChange={(e) => setStackForm({ ...stackForm, name: e.target.value })}
                  autoFocus
                />
                <textarea
                  className="input textarea"
                  rows={2}
                  placeholder="Description — what does this tool do?"
                  value={stackForm.description}
                  onChange={(e) => setStackForm({ ...stackForm, description: e.target.value })}
                />
                <div className="inline-form-row">
                  <select
                    className="select"
                    value={stackForm.category}
                    onChange={(e) => setStackForm({ ...stackForm, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    className="select"
                    value={stackForm.status}
                    onChange={(e) => setStackForm({ ...stackForm, status: e.target.value as ToolStatus })}
                  >
                    <option value="Active">Active</option>
                    <option value="Evaluating">Evaluating</option>
                    <option value="Deprecated">Deprecated</option>
                  </select>
                </div>
                <input
                  className="input"
                  placeholder="Teams (comma-separated, e.g. Sales, Marketing)"
                  value={stackForm.teams}
                  onChange={(e) => setStackForm({ ...stackForm, teams: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Team usage (e.g. Sales: Pipeline tracking, Marketing: Lead scoring)"
                  value={stackForm.teamUsage}
                  onChange={(e) => setStackForm({ ...stackForm, teamUsage: e.target.value })}
                />
                <div className="inline-form-actions">
                  <button className="btn btn-primary btn-sm" onClick={addStackTool}>Add Tool</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setStackForm(blankStack); }}>Cancel</button>
                </div>
              </div>
            )}

            {/* CSV / File Import for Stack */}
            {!showForm && !csvRows && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? "#2563eb" : "#d1d5db"}`,
                  borderRadius: 12,
                  padding: "14px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  marginBottom: 20,
                  background: isDragging ? "#eff6ff" : "#fafafa",
                  transition: "all 0.15s",
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
                <div style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>
                  Drop a CSV or text file to import tools into your stack
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                  CSV columns: name, description, category, teams, status &nbsp;|&nbsp; Or one tool name per line in a .txt file
                </div>
              </div>
            )}

            {/* CSV Preview (Stack) */}
            {csvRows && tab === "stack" && (
              <div style={{ marginBottom: 24, padding: 16, background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Import Preview</span>
                    <span style={{ marginLeft: 8, color: "#6b7280", fontSize: 13 }}>{csvRows.length} tools found</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={importToStack} disabled={csvImporting}>
                      {csvImporting ? "Importing..." : `Import ${csvRows.length} to Stack`}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setCsvRows(null)}>Cancel</button>
                  </div>
                </div>
                <div className="data-table-wrap" style={{ maxHeight: 200, overflow: "auto" }}>
                  <table className="data-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Teams</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{r.name}</td>
                          <td>{r.category}</td>
                          <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</td>
                          <td>{r.teams}</td>
                        </tr>
                      ))}
                      {csvRows.length > 10 && (
                        <tr><td colSpan={4} style={{ textAlign: "center", color: "#9ca3af" }}>
                          ...and {csvRows.length - 10} more
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Stack Cards */}
            {filteredStack.length === 0 && !csvRows ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
                  <rect x="6" y="10" width="36" height="28" rx="3" />
                  <line x1="6" y1="18" x2="42" y2="18" />
                  <line x1="18" y1="18" x2="18" y2="38" />
                </svg>
                <h3>No tools in your stack yet</h3>
                <p>Add tools manually, via AI chat, or import a CSV to get started.</p>
              </div>
            ) : (
              <div className="lib-grid">
                {filteredStack.map((tool) => {
                  const isExpanded = expandedId === tool.id;
                  const statusClass = tool.status === "Active" ? "stack-badge-active"
                    : tool.status === "Evaluating" ? "stack-badge-evaluating"
                    : "stack-badge-deprecated";
                  return (
                    <div
                      key={tool.id}
                      className={`stack-card${isExpanded ? " stack-card-expanded" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : tool.id)}
                    >
                      <div className="stack-card-body">
                        <button
                          className="stack-card-delete"
                          onClick={(e) => { e.stopPropagation(); removeStackTool(tool.id); }}
                          title="Remove from stack"
                        >&times;</button>

                        <div className="stack-card-header">
                          <div>
                            <div className="stack-card-name">{tool.name}</div>
                            <div className="stack-card-badges">
                              {tool.category && (
                                <span className="stack-badge stack-badge-category">{tool.category}</span>
                              )}
                              <span className={`stack-badge ${statusClass}`}>{tool.status}</span>
                            </div>
                          </div>
                        </div>

                        {tool.description && (
                          <div
                            className="stack-card-desc"
                            style={{ WebkitLineClamp: isExpanded ? 999 : 2 }}
                          >
                            {tool.description}
                          </div>
                        )}

                        {tool.teams.length > 0 && (
                          <div className="stack-card-teams">
                            {tool.teams.map((t) => (
                              <span key={t} className="stack-team-tag">{t}</span>
                            ))}
                          </div>
                        )}

                        {isExpanded && Object.keys(tool.team_usage).length > 0 && (
                          <div className="stack-card-expand">
                            <div className="stack-card-expand-title">Team Usage</div>
                            {Object.entries(tool.team_usage).map(([team, usage]) => (
                              <div key={team} className="stack-usage-row">
                                <span className="stack-usage-team">{team}:</span>
                                <span>{usage}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════
           TAB 2: TOOL CATALOG
           ═══════════════════════════════════════════ */}
        {tab === "catalog" && (
          <>
            {/* Catalog Cards */}
            {filteredCatalog.length === 0 && !csvRows ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
                  <path d="M12 6h24a3 3 0 0 1 3 3v30a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z" />
                  <line x1="16" y1="14" x2="32" y2="14" />
                  <line x1="16" y1="22" x2="28" y2="22" />
                  <line x1="16" y1="30" x2="24" y2="30" />
                </svg>
                <h3>No tools in the catalog yet</h3>
                <p>The tool catalog will be pre-loaded with hundreds of tools for evaluation and comparison. Ask the AI to search for tools or run the seed script to get started.</p>
              </div>
            ) : (
              <div className="lib-grid">
                {filteredCatalog.map((tool) => {
                  const isExpanded = expandedId === tool.id;
                  const inStack = stackTools.some((s) => s.name.toLowerCase() === tool.name.toLowerCase());
                  return (
                    <div
                      key={tool.id}
                      className={`stack-card${isExpanded ? " stack-card-expanded" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : tool.id)}
                    >
                      <div className="stack-card-body">
                        <div className="stack-card-header">
                          <div style={{ flex: 1 }}>
                            <div className="stack-card-name">{tool.name}</div>
                            <div className="stack-card-badges">
                              {tool.category && (
                                <span className="stack-badge stack-badge-category">{tool.category}</span>
                              )}
                              {tool.subcategory && (
                                <span className="stack-badge" style={{ background: "#f5f3ff", color: "#7c3aed" }}>{tool.subcategory}</span>
                              )}
                              {tool.pricing && (
                                <span className="catalog-card-pricing">{tool.pricing}</span>
                              )}
                            </div>
                          </div>
                          <div>
                            {inStack ? (
                              <span className="catalog-in-stack">In Stack</span>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                                onClick={(e) => { e.stopPropagation(); addCatalogToStack(tool); }}
                              >+ Add to Stack</button>
                            )}
                          </div>
                        </div>

                        <div
                          className="stack-card-desc"
                          style={{ WebkitLineClamp: isExpanded ? 999 : 2 }}
                        >
                          {tool.description}
                        </div>

                        {tool.best_for && !isExpanded && (
                          <div className="catalog-card-bestfor">
                            <strong>Best for:</strong> {tool.best_for}
                          </div>
                        )}

                        {isExpanded && (
                          <div className="stack-card-expand">
                            {tool.best_for && (
                              <div className="catalog-section">
                                <div className="catalog-section-title">Best for</div>
                                <div style={{ fontSize: 13, color: "#6b7280" }}>{tool.best_for}</div>
                              </div>
                            )}

                            {tool.key_features.length > 0 && (
                              <div className="catalog-section">
                                <div className="catalog-section-title">Key Features</div>
                                <ul className="catalog-feature-list">
                                  {tool.key_features.map((f, i) => <li key={i}>{f}</li>)}
                                </ul>
                              </div>
                            )}

                            {tool.pros.length > 0 && (
                              <div className="catalog-section">
                                <div className="catalog-section-title" style={{ color: "#16a34a" }}>Pros</div>
                                <ul className="catalog-feature-list">
                                  {tool.pros.map((p, i) => <li key={i}>{p}</li>)}
                                </ul>
                              </div>
                            )}

                            {tool.cons.length > 0 && (
                              <div className="catalog-section">
                                <div className="catalog-section-title" style={{ color: "#dc2626" }}>Cons</div>
                                <ul className="catalog-feature-list">
                                  {tool.cons.map((c, i) => <li key={i}>{c}</li>)}
                                </ul>
                              </div>
                            )}

                            {tool.integrations.length > 0 && (
                              <div className="catalog-section">
                                <div className="catalog-section-title">Integrations</div>
                                <div className="catalog-integration-tags">
                                  {tool.integrations.map((int, i) => (
                                    <span key={i} className="catalog-integration-tag">{int}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {tool.website && (
                              <div className="catalog-section">
                                <div className="catalog-section-title">Website</div>
                                <span style={{ fontSize: 13, color: "#2563eb" }}>{tool.website}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
