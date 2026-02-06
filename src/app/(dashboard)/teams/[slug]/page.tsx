"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";

/* ── Types ──────────────────────────────────────────────── */

interface Role {
  id: string;
  name: string;
  description: string;
  headcount: number;
}

type Period = "Day" | "Week" | "Month" | "Quarter" | "Year";

interface KPI {
  id: string;
  name: string;
  current: number | "";
  target: number | "";
  period: Period;
}

interface Tool {
  id: string;
  name: string;
  purpose: string;
}

/* ── Team display names ─────────────────────────────────── */

const teamNames: Record<string, string> = {
  sales: "Sales",
  marketing: "Marketing",
  "customer-success": "Customer Success",
};

/* ── Unique ID helper ───────────────────────────────────── */

let counter = 0;
const uid = () => `item-${++counter}-${Date.now()}`;

/* ── Component ──────────────────────────────────────────── */

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const teamName = teamNames[slug] || slug;

  /* ── State ── */
  const [roles, setRoles] = useState<Role[]>([]);
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [description, setDescription] = useState("");

  /* ── Form visibility toggles ── */
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [showKpiForm, setShowKpiForm] = useState(false);
  const [showToolForm, setShowToolForm] = useState(false);

  /* ── Role form state ── */
  const [newRole, setNewRole] = useState({ name: "", description: "", headcount: 1 });
  /* ── KPI form state ── */
  const [newKpi, setNewKpi] = useState<{ name: string; current: number | ""; target: number | ""; period: Period }>({ name: "", current: "", target: "", period: "Month" });
  /* ── Tool form state ── */
  const [newTool, setNewTool] = useState({ name: "", purpose: "" });

  /* ── Editing state ── */
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editingKpi, setEditingKpi] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<string | null>(null);

  /* ── Handlers: Roles ── */
  const addRole = () => {
    if (!newRole.name.trim()) return;
    setRoles([...roles, { id: uid(), ...newRole }]);
    setNewRole({ name: "", description: "", headcount: 1 });
    setShowRoleForm(false);
  };

  const updateRole = (id: string, updates: Partial<Role>) => {
    setRoles(roles.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const deleteRole = (id: string) => {
    setRoles(roles.filter((r) => r.id !== id));
    if (editingRole === id) setEditingRole(null);
  };

  /* ── Period options ── */
  const periods: Period[] = ["Day", "Week", "Month", "Quarter", "Year"];

  /* ── Format helper ── */
  const fmtKpiValue = (val: number | "", period: Period) =>
    val !== "" ? `${val.toLocaleString()} / ${period}` : "—";

  /* ── Handlers: KPIs ── */
  const addKpi = () => {
    if (!newKpi.name.trim()) return;
    setKpis([...kpis, { id: uid(), ...newKpi }]);
    setNewKpi({ name: "", current: "", target: "", period: "Month" });
    setShowKpiForm(false);
  };

  const updateKpi = (id: string, updates: Partial<KPI>) => {
    setKpis(kpis.map((k) => (k.id === id ? { ...k, ...updates } : k)));
  };

  const deleteKpi = (id: string) => {
    setKpis(kpis.filter((k) => k.id !== id));
    if (editingKpi === id) setEditingKpi(null);
  };

  /* ── Handlers: Tools ── */
  const addTool = () => {
    if (!newTool.name.trim()) return;
    setTools([...tools, { id: uid(), ...newTool }]);
    setNewTool({ name: "", purpose: "" });
    setShowToolForm(false);
  };

  const updateTool = (id: string, updates: Partial<Tool>) => {
    setTools(tools.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const deleteTool = (id: string) => {
    setTools(tools.filter((t) => t.id !== id));
    if (editingTool === id) setEditingTool(null);
  };

  /* ── Computed stats ── */
  const totalHeadcount = roles.reduce((sum, r) => sum + r.headcount, 0);

  return (
    <>
      {/* Header */}
      <div className="canvas-header">
        <h1 className="canvas-title">{teamName}</h1>
        <p className="canvas-subtitle">
          Define roles, KPIs, and tools for this team
        </p>
      </div>

      {/* Content */}
      <div className="canvas-content">
        {/* ─── Stats ─── */}
        <div className="stat-grid stat-grid-3" style={{ marginBottom: 32 }}>
          <div className="stat-box">
            <div className="stat-value">{totalHeadcount || "—"}</div>
            <div className="stat-label">Headcount</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{roles.length || "—"}</div>
            <div className="stat-label">Roles</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{kpis.length || "—"}</div>
            <div className="stat-label">KPIs</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            ROLES & FUNCTIONS
            ═══════════════════════════════════════════════════════ */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">Roles &amp; Functions</h3>
            <button
              className="text-link"
              onClick={() => setShowRoleForm(!showRoleForm)}
            >
              {showRoleForm ? "Cancel" : "+ Add Role"}
            </button>
          </div>

          {/* Add Role Form */}
          {showRoleForm && (
            <div className="inline-form">
              <div className="inline-form-row">
                <input
                  className="input"
                  placeholder="Role name (e.g. SDR, Account Executive)"
                  value={newRole.name}
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                  autoFocus
                />
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder="Count"
                  value={newRole.headcount}
                  onChange={(e) =>
                    setNewRole({ ...newRole, headcount: parseInt(e.target.value) || 1 })
                  }
                  style={{ width: 80, flexShrink: 0 }}
                />
              </div>
              <input
                className="input"
                placeholder="Description (optional)"
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addRole()}
              />
              <div className="inline-form-actions">
                <button className="btn btn-primary btn-sm" onClick={addRole}>
                  Add Role
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowRoleForm(false);
                    setNewRole({ name: "", description: "", headcount: 1 });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Role List */}
          {roles.length === 0 && !showRoleForm ? (
            <p className="empty-text">
              No roles defined yet. Add roles to describe who works on this team.
            </p>
          ) : (
            <div className="item-list">
              {roles.map((role) => (
                <div key={role.id} className="item-row">
                  {editingRole === role.id ? (
                    /* Editing mode */
                    <div className="inline-form" style={{ margin: 0, padding: 0, border: "none" }}>
                      <div className="inline-form-row">
                        <input
                          className="input"
                          value={role.name}
                          onChange={(e) => updateRole(role.id, { name: e.target.value })}
                          autoFocus
                        />
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={role.headcount}
                          onChange={(e) =>
                            updateRole(role.id, { headcount: parseInt(e.target.value) || 1 })
                          }
                          style={{ width: 80, flexShrink: 0 }}
                        />
                      </div>
                      <input
                        className="input"
                        value={role.description}
                        onChange={(e) => updateRole(role.id, { description: e.target.value })}
                        placeholder="Description"
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setEditingRole(null)}
                        style={{ marginTop: 4 }}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    /* Display mode */
                    <>
                      <div className="item-content" onClick={() => setEditingRole(role.id)}>
                        <div className="item-name">
                          {role.name}
                          <span className="item-badge">{role.headcount}</span>
                        </div>
                        {role.description && (
                          <div className="item-desc">{role.description}</div>
                        )}
                      </div>
                      <button
                        className="item-delete"
                        onClick={() => deleteRole(role.id)}
                        title="Remove role"
                      >
                        &times;
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════
            KPIs
            ═══════════════════════════════════════════════════════ */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">KPIs</h3>
            <button
              className="text-link"
              onClick={() => setShowKpiForm(!showKpiForm)}
            >
              {showKpiForm ? "Cancel" : "+ Add KPI"}
            </button>
          </div>

          {/* Add KPI Form */}
          {showKpiForm && (
            <div className="inline-form">
              <input
                className="input"
                placeholder="Metric name (e.g. Qualified Leads, Demos Booked)"
                value={newKpi.name}
                onChange={(e) => setNewKpi({ ...newKpi, name: e.target.value })}
                autoFocus
              />
              <div className="inline-form-row">
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Current"
                  value={newKpi.current}
                  onChange={(e) =>
                    setNewKpi({ ...newKpi, current: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Target"
                  value={newKpi.target}
                  onChange={(e) =>
                    setNewKpi({ ...newKpi, target: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
                <select
                  className="select"
                  value={newKpi.period}
                  onChange={(e) => setNewKpi({ ...newKpi, period: e.target.value as Period })}
                  style={{ flexShrink: 0 }}
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>/ {p}</option>
                  ))}
                </select>
              </div>
              <div className="inline-form-actions">
                <button className="btn btn-primary btn-sm" onClick={addKpi}>
                  Add KPI
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowKpiForm(false);
                    setNewKpi({ name: "", current: "", target: "", period: "Month" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* KPI List */}
          {kpis.length === 0 && !showKpiForm ? (
            <p className="empty-text">
              No KPIs defined yet. Add the metrics this team tracks.
            </p>
          ) : (
            <div className="item-list">
              {kpis.map((kpi) => (
                <div key={kpi.id} className="item-row">
                  {editingKpi === kpi.id ? (
                    <div className="inline-form" style={{ margin: 0, padding: 0, border: "none" }}>
                      <input
                        className="input"
                        value={kpi.name}
                        onChange={(e) => updateKpi(kpi.id, { name: e.target.value })}
                        autoFocus
                      />
                      <div className="inline-form-row">
                        <input
                          className="input"
                          type="number"
                          min={0}
                          placeholder="Current"
                          value={kpi.current}
                          onChange={(e) =>
                            updateKpi(kpi.id, { current: e.target.value === "" ? "" : Number(e.target.value) })
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          min={0}
                          placeholder="Target"
                          value={kpi.target}
                          onChange={(e) =>
                            updateKpi(kpi.id, { target: e.target.value === "" ? "" : Number(e.target.value) })
                          }
                        />
                        <select
                          className="select"
                          value={kpi.period}
                          onChange={(e) => updateKpi(kpi.id, { period: e.target.value as Period })}
                          style={{ flexShrink: 0 }}
                        >
                          {periods.map((p) => (
                            <option key={p} value={p}>/ {p}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setEditingKpi(null)}
                        style={{ marginTop: 4 }}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="item-content" onClick={() => setEditingKpi(kpi.id)}>
                        <div className="item-name">{kpi.name}</div>
                        <div className="item-meta">
                          <span>
                            Current: <strong>{fmtKpiValue(kpi.current, kpi.period)}</strong>
                          </span>
                          <span>
                            Target: <strong>{fmtKpiValue(kpi.target, kpi.period)}</strong>
                          </span>
                        </div>
                      </div>
                      <button
                        className="item-delete"
                        onClick={() => deleteKpi(kpi.id)}
                        title="Remove KPI"
                      >
                        &times;
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════
            TOOLS USED
            ═══════════════════════════════════════════════════════ */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">Tools Used</h3>
            <button
              className="text-link"
              onClick={() => setShowToolForm(!showToolForm)}
            >
              {showToolForm ? "Cancel" : "+ Add Tool"}
            </button>
          </div>

          {/* Add Tool Form */}
          {showToolForm && (
            <div className="inline-form">
              <input
                className="input"
                placeholder="Tool name (e.g. Salesforce, Apollo, Gong)"
                value={newTool.name}
                onChange={(e) => setNewTool({ ...newTool, name: e.target.value })}
                autoFocus
              />
              <input
                className="input"
                placeholder="Purpose (e.g. CRM, Prospecting, Call recording)"
                value={newTool.purpose}
                onChange={(e) => setNewTool({ ...newTool, purpose: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addTool()}
              />
              <div className="inline-form-actions">
                <button className="btn btn-primary btn-sm" onClick={addTool}>
                  Add Tool
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowToolForm(false);
                    setNewTool({ name: "", purpose: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Tool List */}
          {tools.length === 0 && !showToolForm ? (
            <p className="empty-text">
              No tools listed yet. Add the tools this team uses daily.
            </p>
          ) : (
            <div className="item-list">
              {tools.map((tool) => (
                <div key={tool.id} className="item-row">
                  {editingTool === tool.id ? (
                    <div className="inline-form" style={{ margin: 0, padding: 0, border: "none" }}>
                      <input
                        className="input"
                        value={tool.name}
                        onChange={(e) => updateTool(tool.id, { name: e.target.value })}
                        autoFocus
                      />
                      <input
                        className="input"
                        value={tool.purpose}
                        onChange={(e) => updateTool(tool.id, { purpose: e.target.value })}
                        placeholder="Purpose"
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setEditingTool(null)}
                        style={{ marginTop: 4 }}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="item-content" onClick={() => setEditingTool(tool.id)}>
                        <div className="item-name">{tool.name}</div>
                        {tool.purpose && (
                          <div className="item-desc">{tool.purpose}</div>
                        )}
                      </div>
                      <button
                        className="item-delete"
                        onClick={() => deleteTool(tool.id)}
                        title="Remove tool"
                      >
                        &times;
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════
            HOW THIS TEAM WORKS
            ═══════════════════════════════════════════════════════ */}
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">How This Team Works</h3>
          </div>
          <textarea
            className="input textarea"
            rows={4}
            placeholder="Describe how this team operates, their daily workflow, key processes..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}
