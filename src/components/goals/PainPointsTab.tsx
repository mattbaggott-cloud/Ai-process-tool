"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { GoalStatus, PainPointSeverity } from "@/lib/types/database";
import { StatusPill, TeamPicker, statuses, statusStyles } from "./GoalsTab";

/* ══════════════════════════════════════════════════════════
   LOCAL TYPES
   ══════════════════════════════════════════════════════════ */

interface PainPointLocal {
  id: string;
  name: string;
  description: string;
  severity: PainPointSeverity;
  status: GoalStatus;
  teams: string[];
  owner: string;
  impact_metric: string;
  linked_goal_id: string | null;
  linked_goal_name?: string;
  created_at: string;
}

interface GoalOption {
  id: string;
  name: string;
}

/* ── Severity config ─────────────────────────────────────── */

const severities: PainPointSeverity[] = ["Low", "Medium", "High", "Critical"];

const severityStyles: Record<PainPointSeverity, { bg: string; color: string; dot: string }> = {
  Low:      { bg: "#f0fdf4", color: "#16a34a", dot: "#16a34a" },
  Medium:   { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  High:     { bg: "#fff7ed", color: "#c2410c", dot: "#ea580c" },
  Critical: { bg: "#fef2f2", color: "#dc2626", dot: "#dc2626" },
};

/* ── Blank state ─────────────────────────────────────────── */

const blankPainPoint = (): Omit<PainPointLocal, "id" | "created_at" | "linked_goal_name"> => ({
  name: "", description: "", severity: "Medium", status: "Backlog",
  teams: [], owner: "", impact_metric: "", linked_goal_id: null,
});

/* ── Severity badge ──────────────────────────────────────── */

function SeverityBadge({ severity }: { severity: PainPointSeverity }) {
  const s = severityStyles[severity];
  return (
    <span className="severity-badge" style={{ background: s.bg, color: s.color }}>
      <span className="severity-badge-dot" style={{ background: s.dot }} />
      {severity}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   PAIN POINT FORM
   ══════════════════════════════════════════════════════════ */

function PainPointForm({
  pp,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  goals,
}: {
  pp: Omit<PainPointLocal, "id" | "created_at" | "linked_goal_name">;
  onChange: (p: Omit<PainPointLocal, "id" | "created_at" | "linked_goal_name">) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  goals: GoalOption[];
}) {
  return (
    <div className="inline-form">
      <input
        className="input"
        placeholder="Pain point name (e.g. High customer churn in first 90 days)"
        value={pp.name}
        onChange={(e) => onChange({ ...pp, name: e.target.value })}
        autoFocus
      />
      <textarea
        className="input textarea"
        rows={2}
        placeholder="Description — what's the impact and root cause?"
        value={pp.description}
        onChange={(e) => onChange({ ...pp, description: e.target.value })}
      />

      {/* Severity + Status */}
      <div className="inline-form-row">
        <div style={{ flex: 1 }}>
          <label className="field-label">Severity</label>
          <select
            className="select"
            value={pp.severity}
            onChange={(e) => onChange({ ...pp, severity: e.target.value as PainPointSeverity })}
          >
            {severities.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Status</label>
          <select
            className="select"
            value={pp.status}
            onChange={(e) => onChange({ ...pp, status: e.target.value as GoalStatus })}
          >
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Owner + Impact */}
      <div className="inline-form-row">
        <input
          className="input"
          placeholder="Owner (e.g. Sarah K.)"
          value={pp.owner}
          onChange={(e) => onChange({ ...pp, owner: e.target.value })}
        />
        <input
          className="input"
          placeholder="Impact metric (e.g. Customer churn: 15%)"
          value={pp.impact_metric}
          onChange={(e) => onChange({ ...pp, impact_metric: e.target.value })}
        />
      </div>

      {/* Linked Goal */}
      <div style={{ marginBottom: 4 }}>
        <label className="field-label">Linked Goal</label>
        <select
          className="select"
          value={pp.linked_goal_id ?? ""}
          onChange={(e) => onChange({ ...pp, linked_goal_id: e.target.value || null })}
        >
          <option value="">None</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <TeamPicker selected={pp.teams} onChange={(teams) => onChange({ ...pp, teams })} />

      <div className="inline-form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave}>{saveLabel}</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PAIN POINTS TAB COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function PainPointsTab() {
  const { user } = useAuth();
  const supabase = createClient();

  const [painPoints, setPainPoints] = useState<PainPointLocal[]>([]);
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | PainPointSeverity>("All");

  const [newPP, setNewPP] = useState(blankPainPoint());
  const [editForm, setEditForm] = useState(blankPainPoint());

  /* ── Load pain points + goals for dropdown ── */
  const loadData = useCallback(async () => {
    if (!user) return;

    const [ppRes, goalsRes] = await Promise.all([
      supabase.from("pain_points").select("*").order("created_at", { ascending: false }),
      supabase.from("goals").select("id, name").order("created_at", { ascending: false }),
    ]);

    const ppData = ppRes.data ?? [];
    const goalsData = goalsRes.data ?? [];

    setGoals(goalsData.map((g) => ({ id: g.id, name: g.name })));

    const goalMap = new Map(goalsData.map((g) => [g.id, g.name]));

    setPainPoints(
      ppData.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        severity: row.severity as PainPointSeverity,
        status: row.status as GoalStatus,
        teams: row.teams ?? [],
        owner: row.owner ?? "",
        impact_metric: row.impact_metric ?? "",
        linked_goal_id: row.linked_goal_id,
        linked_goal_name: row.linked_goal_id ? goalMap.get(row.linked_goal_id) ?? undefined : undefined,
        created_at: row.created_at,
      }))
    );
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadData]);

  /* ── CRUD ── */

  const addPainPoint = async () => {
    if (!newPP.name.trim() || !user) return;
    const { data: row, error } = await supabase
      .from("pain_points")
      .insert({
        user_id: user.id, name: newPP.name, description: newPP.description,
        severity: newPP.severity, status: newPP.status, teams: newPP.teams,
        owner: newPP.owner, impact_metric: newPP.impact_metric,
        linked_goal_id: newPP.linked_goal_id,
      })
      .select().single();

    if (error || !row) { console.error("Add pain point error:", error?.message); return; }

    const goalName = row.linked_goal_id ? goals.find((g) => g.id === row.linked_goal_id)?.name : undefined;
    setPainPoints((prev) => [{
      id: row.id, name: row.name, description: row.description ?? "",
      severity: row.severity as PainPointSeverity, status: row.status as GoalStatus,
      teams: row.teams ?? [], owner: row.owner ?? "",
      impact_metric: row.impact_metric ?? "", linked_goal_id: row.linked_goal_id,
      linked_goal_name: goalName, created_at: row.created_at,
    }, ...prev]);
    setNewPP(blankPainPoint());
    setShowForm(false);
  };

  const updatePainPoint = async (id: string, updates: Partial<Omit<PainPointLocal, "id" | "created_at" | "linked_goal_name">>) => {
    const { error } = await supabase.from("pain_points").update(updates).eq("id", id);
    if (error) { console.error("Update pain point error:", error.message); return; }
    setPainPoints((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      if ("linked_goal_id" in updates) {
        updated.linked_goal_name = updates.linked_goal_id
          ? goals.find((g) => g.id === updates.linked_goal_id)?.name
          : undefined;
      }
      return updated;
    }));
  };

  const deletePainPoint = async (id: string) => {
    const { error } = await supabase.from("pain_points").delete().eq("id", id);
    if (error) { console.error("Delete pain point error:", error.message); return; }
    setPainPoints((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const startEdit = (pp: PainPointLocal) => {
    setEditingId(pp.id);
    setEditForm({
      name: pp.name, description: pp.description, severity: pp.severity,
      status: pp.status, teams: pp.teams, owner: pp.owner,
      impact_metric: pp.impact_metric, linked_goal_id: pp.linked_goal_id,
    });
  };

  const saveEdit = async (id: string) => {
    await updatePainPoint(id, editForm);
    setEditingId(null);
  };

  /* ── Filter & counts ── */
  const filtered = filter === "All" ? painPoints : painPoints.filter((p) => p.severity === filter);
  const countFor = (s: PainPointSeverity) => painPoints.filter((p) => p.severity === s).length;
  const filters: { label: string; value: "All" | PainPointSeverity; count: number }[] = [
    { label: "All", value: "All", count: painPoints.length },
    ...severities.map((s) => ({ label: s, value: s as "All" | PainPointSeverity, count: countFor(s) })),
  ];

  if (loading) {
    return <div className="empty-state"><p>Loading pain points…</p></div>;
  }

  return (
    <>
      {/* + New Pain Point */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Pain Point"}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: 24 }}>
          <PainPointForm
            pp={newPP}
            onChange={setNewPP}
            onSave={addPainPoint}
            onCancel={() => { setShowForm(false); setNewPP(blankPainPoint()); }}
            saveLabel="Add Pain Point"
            goals={goals}
          />
        </div>
      )}

      {/* Filter pills by severity */}
      {painPoints.length > 0 && (
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

      {/* Stats */}
      {painPoints.length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(4, 1fr)" }}>
          {severities.map((s) => (
            <div key={s} className="stat-box">
              <div className="stat-value" style={{ color: severityStyles[s].color }}>{countFor(s)}</div>
              <div className="stat-label">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* Pain Point Cards */}
      {filtered.length === 0 && !showForm ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
            <path d="M24 6v18M24 30v2" strokeLinecap="round" />
            <circle cx="24" cy="24" r="18" />
          </svg>
          <h3>{painPoints.length === 0 ? "No pain points yet" : "No matching pain points"}</h3>
          <p>{painPoints.length === 0
            ? "Add your first pain point to track challenges and bottlenecks."
            : "Try changing the filter above to see other pain points."}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((pp) => (
            <div key={pp.id} className="pain-point-card-wrap">
              <div className="pain-point-card">
                {editingId === pp.id ? (
                  <div style={{ flex: 1 }}>
                    <PainPointForm
                      pp={editForm}
                      onChange={setEditForm}
                      onSave={() => saveEdit(pp.id)}
                      onCancel={() => setEditingId(null)}
                      saveLabel="Done"
                      goals={goals}
                    />
                  </div>
                ) : (
                  <>
                    <div className="pain-point-card-content" onClick={() => startEdit(pp)}>
                      {/* Severity + Status + Teams */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <SeverityBadge severity={pp.severity} />
                        <StatusPill status={pp.status} />
                        {pp.teams.map((t) => <span key={t} className="tag">{t}</span>)}
                        {pp.owner && <span className="tag tag-blue">{pp.owner}</span>}
                      </div>

                      {/* Name */}
                      <div className="item-name" style={{ fontSize: 15, marginBottom: 2 }}>{pp.name}</div>
                      {pp.description && <div className="item-desc">{pp.description}</div>}

                      {/* Impact metric */}
                      {pp.impact_metric && (
                        <div className="goal-meta-row" style={{ marginTop: 6 }}>
                          <span className="goal-meta-item" style={{ fontSize: 12 }}>
                            {pp.impact_metric}
                          </span>
                        </div>
                      )}

                      {/* Linked goal */}
                      {pp.linked_goal_name && (
                        <div className="linked-goal-tag">
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M5 7l2-2M3.5 8.5a2.12 2.12 0 0 1 0-3l1-1a2.12 2.12 0 0 1 3 0M7.5 3.5a2.12 2.12 0 0 1 0 3l-1 1a2.12 2.12 0 0 1-3 0" />
                          </svg>
                          {pp.linked_goal_name}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                      <button className="item-delete" onClick={() => deletePainPoint(pp.id)} title="Remove pain point">&times;</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
