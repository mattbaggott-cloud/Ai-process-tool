"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { GoalStatus } from "@/lib/types/database";

/* ══════════════════════════════════════════════════════════
   LOCAL TYPES  (matches Supabase columns — snake_case)
   ══════════════════════════════════════════════════════════ */

interface Goal {
  id: string;
  name: string;
  description: string;
  status: GoalStatus;
  teams: string[];
  owner: string;
  start_date: string | null;
  end_date: string | null;
  metric: string;
  metric_target: string;
  created_at: string;
  /* joined client-side */
  subGoals: SubGoal[];
}

interface SubGoal {
  id: string;
  goal_id: string;
  name: string;
  description: string;
  status: GoalStatus;
  owner: string;
  end_date: string | null;
}

/* ── Exported shared config ───────────────────────────────── */

export const statuses: GoalStatus[] = ["Backlog", "To Do", "In Progress", "In Review", "Done"];

export const statusStyles: Record<GoalStatus, { bg: string; color: string; dot: string }> = {
  Backlog:       { bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" },
  "To Do":       { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  "In Progress": { bg: "#eff6ff", color: "#2563eb", dot: "#2563eb" },
  "In Review":   { bg: "#f5f3ff", color: "#7c3aed", dot: "#7c3aed" },
  Done:          { bg: "#f0fdf4", color: "#16a34a", dot: "#16a34a" },
};

export const teamOptions = ["Sales", "Marketing", "Customer Success"];

/* ── Blank states ───────────────────────────────────────── */

const blankGoal = (): Omit<Goal, "id" | "created_at" | "subGoals"> => ({
  name: "", description: "", status: "Backlog", teams: [],
  owner: "", start_date: null, end_date: null, metric: "", metric_target: "",
});

const blankSub = (): Omit<SubGoal, "id" | "goal_id"> => ({
  name: "", description: "", status: "Backlog", owner: "", end_date: null,
});

/* ══════════════════════════════════════════════════════════
   SMALL REUSABLE PIECES (exported for PainPointsTab)
   ══════════════════════════════════════════════════════════ */

export function StatusPill({ status }: { status: GoalStatus }) {
  const s = statusStyles[status];
  return (
    <span className="goal-status-pill" style={{ background: s.bg, color: s.color }}>
      <span className="goal-status-dot" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

export function TeamPicker({ selected, onChange }: { selected: string[]; onChange: (t: string[]) => void }) {
  const toggle = (team: string) =>
    onChange(selected.includes(team) ? selected.filter((t) => t !== team) : [...selected, team]);
  return (
    <div className="team-picker">
      <span className="team-picker-label">Teams:</span>
      {teamOptions.map((team) => (
        <label key={team} className="team-checkbox">
          <input type="checkbox" checked={selected.includes(team)} onChange={() => toggle(team)} />
          <span>{team}</span>
        </label>
      ))}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-label">{done}/{total} sub-goals done</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   GOAL FORM (used for both add & edit)
   ══════════════════════════════════════════════════════════ */

function GoalForm({
  goal,
  onChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  goal: Omit<Goal, "id" | "created_at" | "subGoals">;
  onChange: (g: Omit<Goal, "id" | "created_at" | "subGoals">) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <div className="inline-form">
      <input
        className="input"
        placeholder="Goal name (e.g. Increase pipeline by 40%)"
        value={goal.name}
        onChange={(e) => onChange({ ...goal, name: e.target.value })}
        autoFocus
      />
      <textarea
        className="input textarea"
        rows={2}
        placeholder="Description — what does success look like?"
        value={goal.description}
        onChange={(e) => onChange({ ...goal, description: e.target.value })}
      />

      {/* Status + Owner */}
      <div className="inline-form-row">
        <select
          className="select"
          value={goal.status}
          onChange={(e) => onChange({ ...goal, status: e.target.value as GoalStatus })}
        >
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="input"
          placeholder="Owner (e.g. Sarah K.)"
          value={goal.owner}
          onChange={(e) => onChange({ ...goal, owner: e.target.value })}
        />
      </div>

      {/* Timeline */}
      <div className="inline-form-row">
        <div style={{ flex: 1 }}>
          <label className="field-label">Start Date</label>
          <input
            className="input"
            type="date"
            value={goal.start_date ?? ""}
            onChange={(e) => onChange({ ...goal, start_date: e.target.value || null })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">End Date</label>
          <input
            className="input"
            type="date"
            value={goal.end_date ?? ""}
            onChange={(e) => onChange({ ...goal, end_date: e.target.value || null })}
          />
        </div>
      </div>

      {/* Measurable */}
      <div className="inline-form-row">
        <input
          className="input"
          placeholder="Metric (e.g. Pipeline revenue)"
          value={goal.metric}
          onChange={(e) => onChange({ ...goal, metric: e.target.value })}
        />
        <input
          className="input"
          placeholder="Target (e.g. $2M)"
          value={goal.metric_target}
          onChange={(e) => onChange({ ...goal, metric_target: e.target.value })}
        />
      </div>

      <TeamPicker selected={goal.teams} onChange={(teams) => onChange({ ...goal, teams })} />

      <div className="inline-form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave}>{saveLabel}</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   GOALS TAB COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function GoalsTab() {
  const { user } = useAuth();
  const supabase = createClient();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"All" | GoalStatus>("All");
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);

  const [newGoal, setNewGoal] = useState(blankGoal());
  const [newSub, setNewSub] = useState(blankSub());
  const [editForm, setEditForm] = useState(blankGoal());

  /* ── Load goals + sub-goals from Supabase on mount ── */
  const loadGoals = useCallback(async () => {
    if (!user) return;

    const [goalsRes, subsRes] = await Promise.all([
      supabase.from("goals").select("*").order("created_at", { ascending: false }),
      supabase.from("sub_goals").select("*").order("created_at", { ascending: true }),
    ]);

    const goalsData = goalsRes.data ?? [];
    const subsData = subsRes.data ?? [];

    const subsByGoal: Record<string, SubGoal[]> = {};
    for (const s of subsData) {
      if (!subsByGoal[s.goal_id]) subsByGoal[s.goal_id] = [];
      subsByGoal[s.goal_id].push({
        id: s.id,
        goal_id: s.goal_id,
        name: s.name,
        description: s.description ?? "",
        status: s.status,
        owner: s.owner ?? "",
        end_date: s.end_date,
      });
    }

    setGoals(
      goalsData.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        status: row.status,
        teams: row.teams ?? [],
        owner: row.owner ?? "",
        start_date: row.start_date,
        end_date: row.end_date,
        metric: row.metric ?? "",
        metric_target: row.metric_target ?? "",
        created_at: row.created_at,
        subGoals: subsByGoal[row.id] ?? [],
      }))
    );
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  useEffect(() => {
    const handler = () => loadGoals();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadGoals]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* ── Goal CRUD ── */

  const addGoal = async () => {
    if (!newGoal.name.trim() || !user) return;
    const { data: row, error } = await supabase
      .from("goals")
      .insert({
        user_id: user.id, name: newGoal.name, description: newGoal.description,
        status: newGoal.status, teams: newGoal.teams, owner: newGoal.owner,
        start_date: newGoal.start_date, end_date: newGoal.end_date,
        metric: newGoal.metric, metric_target: newGoal.metric_target,
      })
      .select().single();

    if (error || !row) { console.error("Add goal error:", error?.message); return; }

    setGoals((prev) => [{
      id: row.id, name: row.name, description: row.description ?? "",
      status: row.status, teams: row.teams ?? [], owner: row.owner ?? "",
      start_date: row.start_date, end_date: row.end_date,
      metric: row.metric ?? "", metric_target: row.metric_target ?? "",
      created_at: row.created_at, subGoals: [],
    }, ...prev]);
    setNewGoal(blankGoal());
    setShowForm(false);
  };

  const updateGoal = async (id: string, updates: Partial<Omit<Goal, "id" | "created_at" | "subGoals">>) => {
    const { error } = await supabase.from("goals").update(updates).eq("id", id);
    if (error) { console.error("Update goal error:", error.message); return; }
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from("goals").delete().eq("id", id);
    if (error) { console.error("Delete goal error:", error.message); return; }
    setGoals((prev) => prev.filter((g) => g.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const startEdit = (goal: Goal) => {
    setEditingId(goal.id);
    setEditForm({
      name: goal.name, description: goal.description, status: goal.status,
      teams: goal.teams, owner: goal.owner, start_date: goal.start_date,
      end_date: goal.end_date, metric: goal.metric, metric_target: goal.metric_target,
    });
  };

  const saveEdit = async (id: string) => { await updateGoal(id, editForm); setEditingId(null); };

  /* ── Sub-goal CRUD ── */

  const addSubGoal = async (parentId: string) => {
    if (!newSub.name.trim()) return;
    const { data: row, error } = await supabase
      .from("sub_goals")
      .insert({ goal_id: parentId, user_id: user!.id, name: newSub.name, description: newSub.description, status: newSub.status, owner: newSub.owner, end_date: newSub.end_date })
      .select().single();
    if (error || !row) { console.error("Add sub-goal error:", error?.message); return; }
    const sub: SubGoal = { id: row.id, goal_id: row.goal_id, name: row.name, description: row.description ?? "", status: row.status, owner: row.owner ?? "", end_date: row.end_date };
    setGoals((prev) => prev.map((g) => (g.id === parentId ? { ...g, subGoals: [...g.subGoals, sub] } : g)));
    setNewSub(blankSub());
    setAddingSubFor(null);
    setExpandedIds((prev) => new Set(prev).add(parentId));
  };

  const updateSubGoal = async (parentId: string, subId: string, updates: Partial<SubGoal>) => {
    const { error } = await supabase.from("sub_goals").update(updates).eq("id", subId);
    if (error) { console.error("Update sub-goal error:", error.message); return; }
    setGoals((prev) => prev.map((g) => g.id === parentId ? { ...g, subGoals: g.subGoals.map((s) => (s.id === subId ? { ...s, ...updates } : s)) } : g));
  };

  const deleteSubGoal = async (parentId: string, subId: string) => {
    const { error } = await supabase.from("sub_goals").delete().eq("id", subId);
    if (error) { console.error("Delete sub-goal error:", error.message); return; }
    setGoals((prev) => prev.map((g) => g.id === parentId ? { ...g, subGoals: g.subGoals.filter((s) => s.id !== subId) } : g));
  };

  /* ── Filter & counts ── */
  const filtered = filter === "All" ? goals : goals.filter((g) => g.status === filter);
  const countFor = (s: GoalStatus) => goals.filter((g) => g.status === s).length;
  const filters: { label: string; value: "All" | GoalStatus; count: number }[] = [
    { label: "All", value: "All", count: goals.length },
    ...statuses.map((s) => ({ label: s, value: s as "All" | GoalStatus, count: countFor(s) })),
  ];

  const fmtDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return <div className="empty-state"><p>Loading goals…</p></div>;
  }

  return (
    <>
      {/* + New Goal */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Goal"}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: 24 }}>
          <GoalForm
            goal={newGoal}
            onChange={setNewGoal}
            onSave={addGoal}
            onCancel={() => { setShowForm(false); setNewGoal(blankGoal()); }}
            saveLabel="Add Goal"
          />
        </div>
      )}

      {/* Filter pills */}
      {goals.length > 0 && (
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
      {goals.length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(5, 1fr)" }}>
          {statuses.map((s) => (
            <div key={s} className="stat-box">
              <div className="stat-value" style={{ color: statusStyles[s].color }}>{countFor(s)}</div>
              <div className="stat-label">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* Goal Cards */}
      {filtered.length === 0 && !showForm ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
            <circle cx="24" cy="24" r="18" /><circle cx="24" cy="24" r="10" /><circle cx="24" cy="24" r="3" />
          </svg>
          <h3>{goals.length === 0 ? "No goals yet" : "No matching goals"}</h3>
          <p>{goals.length === 0
            ? "Create your first goal to start tracking business objectives."
            : "Try changing the filter above to see other goals."}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((goal) => {
            const isExpanded = expandedIds.has(goal.id);
            const subDone = goal.subGoals.filter((s) => s.status === "Done").length;

            return (
              <div key={goal.id} className="goal-card-wrap">
                <div className="goal-card">
                  {editingId === goal.id ? (
                    <div style={{ flex: 1 }}>
                      <GoalForm
                        goal={editForm}
                        onChange={setEditForm}
                        onSave={() => saveEdit(goal.id)}
                        onCancel={() => setEditingId(null)}
                        saveLabel="Done"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="goal-card-content" onClick={() => startEdit(goal)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <StatusPill status={goal.status} />
                          {goal.teams.map((t) => <span key={t} className="tag">{t}</span>)}
                          {goal.owner && <span className="tag tag-blue">{goal.owner}</span>}
                        </div>
                        <div className="item-name" style={{ fontSize: 15, marginBottom: 2 }}>{goal.name}</div>
                        {goal.description && <div className="item-desc">{goal.description}</div>}
                        <div className="goal-meta-row">
                          {(goal.start_date || goal.end_date) && (
                            <span className="goal-meta-item">
                              {goal.start_date && goal.end_date
                                ? `${fmtDate(goal.start_date)} → ${fmtDate(goal.end_date)}`
                                : goal.end_date
                                ? `Due ${fmtDate(goal.end_date)}`
                                : `Starts ${fmtDate(goal.start_date)}`}
                            </span>
                          )}
                          {goal.metric && (
                            <span className="goal-meta-item">
                              {goal.metric}{goal.metric_target ? `: ${goal.metric_target}` : ""}
                            </span>
                          )}
                        </div>
                        <ProgressBar done={subDone} total={goal.subGoals.length} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                        <button className="item-delete" onClick={() => deleteGoal(goal.id)} title="Remove goal">&times;</button>
                      </div>
                    </>
                  )}
                </div>

                {editingId !== goal.id && goal.subGoals.length > 0 && (
                  <button className="sub-toggle" onClick={() => toggleExpand(goal.id)}>
                    <span style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}>▸</span>
                    {goal.subGoals.length} sub-goal{goal.subGoals.length !== 1 && "s"}
                  </button>
                )}

                {editingId !== goal.id && isExpanded && (
                  <div className="sub-goal-list">
                    {goal.subGoals.map((sub) => (
                      <div key={sub.id} className="sub-goal-row">
                        <select
                          className="sub-status-select"
                          value={sub.status}
                          onChange={(e) => updateSubGoal(goal.id, sub.id, { status: e.target.value as GoalStatus })}
                          style={{ color: statusStyles[sub.status].color }}
                        >
                          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div className="sub-goal-info">
                          <div className="sub-goal-name">{sub.name}</div>
                          {sub.description && <div className="sub-goal-desc">{sub.description}</div>}
                        </div>
                        {sub.owner && <span className="tag" style={{ fontSize: 11 }}>{sub.owner}</span>}
                        {sub.end_date && <span className="goal-meta-item" style={{ fontSize: 11 }}>{fmtDate(sub.end_date)}</span>}
                        <button className="item-delete" onClick={() => deleteSubGoal(goal.id, sub.id)} style={{ width: 20, height: 20, fontSize: 14 }}>&times;</button>
                      </div>
                    ))}
                  </div>
                )}

                {editingId !== goal.id && (
                  <>
                    {addingSubFor === goal.id ? (
                      <div className="sub-goal-form">
                        <div className="inline-form-row">
                          <input className="input" placeholder="Sub-goal name" value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === "Enter" && addSubGoal(goal.id)} />
                          <input className="input" placeholder="Owner" value={newSub.owner} onChange={(e) => setNewSub({ ...newSub, owner: e.target.value })} style={{ width: 120, flexShrink: 0 }} />
                          <input className="input" type="date" value={newSub.end_date ?? ""} onChange={(e) => setNewSub({ ...newSub, end_date: e.target.value || null })} style={{ width: 140, flexShrink: 0 }} />
                        </div>
                        <input className="input" placeholder="Description (optional)" value={newSub.description} onChange={(e) => setNewSub({ ...newSub, description: e.target.value })} />
                        <div className="inline-form-actions">
                          <button className="btn btn-primary btn-sm" onClick={() => addSubGoal(goal.id)}>Add</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setAddingSubFor(null); setNewSub(blankSub()); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="add-sub-btn" onClick={() => { setAddingSubFor(goal.id); setNewSub(blankSub()); }}>
                        + Add sub-goal
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
