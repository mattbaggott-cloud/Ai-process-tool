"use client";

import React, { useState } from "react";

/* ══════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════ */

type Status = "Backlog" | "To Do" | "In Progress" | "In Review" | "Done";

interface Goal {
  id: string;
  name: string;
  description: string;
  status: Status;
  teams: string[];
  /* SMART fields */
  owner: string;
  startDate: string;
  endDate: string;
  metric: string;
  metricTarget: string;
  /* Sub-goals */
  subGoals: SubGoal[];
}

interface SubGoal {
  id: string;
  name: string;
  description: string;
  status: Status;
  owner: string;
  endDate: string;
}

/* ── ID helper ──────────────────────────────────────────── */

let counter = 0;
const uid = () => `g-${++counter}-${Date.now()}`;

/* ── Status config ──────────────────────────────────────── */

const statuses: Status[] = ["Backlog", "To Do", "In Progress", "In Review", "Done"];

const statusStyles: Record<Status, { bg: string; color: string; dot: string }> = {
  Backlog:       { bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" },
  "To Do":       { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  "In Progress": { bg: "#eff6ff", color: "#2563eb", dot: "#2563eb" },
  "In Review":   { bg: "#f5f3ff", color: "#7c3aed", dot: "#7c3aed" },
  Done:          { bg: "#f0fdf4", color: "#16a34a", dot: "#16a34a" },
};

/* ── Teams ──────────────────────────────────────────────── */

const teamOptions = ["Sales", "Marketing", "Customer Success"];

/* ── Blank states ───────────────────────────────────────── */

const blankGoal = (): Omit<Goal, "id"> => ({
  name: "", description: "", status: "Backlog", teams: [],
  owner: "", startDate: "", endDate: "", metric: "", metricTarget: "",
  subGoals: [],
});

const blankSub = (): Omit<SubGoal, "id"> => ({
  name: "", description: "", status: "Backlog", owner: "", endDate: "",
});

/* ══════════════════════════════════════════════════════════
   SMALL REUSABLE PIECES
   ══════════════════════════════════════════════════════════ */

function StatusPill({ status }: { status: Status }) {
  const s = statusStyles[status];
  return (
    <span className="goal-status-pill" style={{ background: s.bg, color: s.color }}>
      <span className="goal-status-dot" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

function TeamPicker({ selected, onChange }: { selected: string[]; onChange: (t: string[]) => void }) {
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
  goal: Omit<Goal, "id">;
  onChange: (g: Omit<Goal, "id">) => void;
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
          onChange={(e) => onChange({ ...goal, status: e.target.value as Status })}
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
            value={goal.startDate}
            onChange={(e) => onChange({ ...goal, startDate: e.target.value })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">End Date</label>
          <input
            className="input"
            type="date"
            value={goal.endDate}
            onChange={(e) => onChange({ ...goal, endDate: e.target.value })}
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
          value={goal.metricTarget}
          onChange={(e) => onChange({ ...goal, metricTarget: e.target.value })}
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
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"All" | Status>("All");
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);

  /* ── New goal form ── */
  const [newGoal, setNewGoal] = useState<Omit<Goal, "id">>(blankGoal());

  /* ── New sub-goal form ── */
  const [newSub, setNewSub] = useState<Omit<SubGoal, "id">>(blankSub());

  /* ── Toggle expand ── */
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* ── Goal CRUD ── */
  const addGoal = () => {
    if (!newGoal.name.trim()) return;
    const id = uid();
    setGoals([...goals, { id, ...newGoal }]);
    setNewGoal(blankGoal());
    setShowForm(false);
  };

  const updateGoal = (id: string, updates: Partial<Goal>) => {
    setGoals(goals.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const deleteGoal = (id: string) => {
    setGoals(goals.filter((g) => g.id !== id));
    if (editingId === id) setEditingId(null);
  };

  /* ── Sub-goal CRUD ── */
  const addSubGoal = (parentId: string) => {
    if (!newSub.name.trim()) return;
    const sub: SubGoal = { id: uid(), ...newSub };
    setGoals(goals.map((g) =>
      g.id === parentId ? { ...g, subGoals: [...g.subGoals, sub] } : g
    ));
    setNewSub(blankSub());
    setAddingSubFor(null);
    // Auto-expand
    setExpandedIds((prev) => new Set(prev).add(parentId));
  };

  const updateSubGoal = (parentId: string, subId: string, updates: Partial<SubGoal>) => {
    setGoals(goals.map((g) =>
      g.id === parentId
        ? { ...g, subGoals: g.subGoals.map((s) => (s.id === subId ? { ...s, ...updates } : s)) }
        : g
    ));
  };

  const deleteSubGoal = (parentId: string, subId: string) => {
    setGoals(goals.map((g) =>
      g.id === parentId ? { ...g, subGoals: g.subGoals.filter((s) => s.id !== subId) } : g
    ));
  };

  /* ── Filter & counts ── */
  const allGoals = goals; // top-level only for filtering
  const filtered = filter === "All" ? allGoals : allGoals.filter((g) => g.status === filter);
  const countFor = (s: Status) => allGoals.filter((g) => g.status === s).length;

  const filters: { label: string; value: "All" | Status; count: number }[] = [
    { label: "All", value: "All", count: allGoals.length },
    ...statuses.map((s) => ({ label: s, value: s as "All" | Status, count: countFor(s) })),
  ];

  /* ── Date formatter ── */
  const fmtDate = (d: string) => {
    if (!d) return "";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Goals</h1>
          <p className="canvas-subtitle">Set objectives, track progress, and link to teams &amp; KPIs</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Goal"}
        </button>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {/* ── New Goal Form ── */}
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

        {/* ── Filter pills ── */}
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

        {/* ── Stats ── */}
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

        {/* ── Goal Cards ── */}
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
                      /* ── Edit mode ── */
                      <div style={{ flex: 1 }}>
                        <GoalForm
                          goal={goal}
                          onChange={(updated) => updateGoal(goal.id, updated)}
                          onSave={() => setEditingId(null)}
                          onCancel={() => setEditingId(null)}
                          saveLabel="Done"
                        />
                      </div>
                    ) : (
                      /* ── Display mode ── */
                      <>
                        <div className="goal-card-content" onClick={() => setEditingId(goal.id)}>
                          {/* Status + teams */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                            <StatusPill status={goal.status} />
                            {goal.teams.map((t) => <span key={t} className="tag">{t}</span>)}
                            {goal.owner && <span className="tag tag-blue">{goal.owner}</span>}
                          </div>

                          {/* Name */}
                          <div className="item-name" style={{ fontSize: 15, marginBottom: 2 }}>{goal.name}</div>
                          {goal.description && <div className="item-desc">{goal.description}</div>}

                          {/* SMART meta row */}
                          <div className="goal-meta-row">
                            {(goal.startDate || goal.endDate) && (
                              <span className="goal-meta-item">
                                {goal.startDate && goal.endDate
                                  ? `${fmtDate(goal.startDate)} → ${fmtDate(goal.endDate)}`
                                  : goal.endDate
                                  ? `Due ${fmtDate(goal.endDate)}`
                                  : `Starts ${fmtDate(goal.startDate)}`}
                              </span>
                            )}
                            {goal.metric && (
                              <span className="goal-meta-item">
                                {goal.metric}{goal.metricTarget ? `: ${goal.metricTarget}` : ""}
                              </span>
                            )}
                          </div>

                          {/* Progress bar */}
                          <ProgressBar done={subDone} total={goal.subGoals.length} />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                          <button className="item-delete" onClick={() => deleteGoal(goal.id)} title="Remove goal">&times;</button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* ── Sub-goals section ── */}
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
                            onChange={(e) => updateSubGoal(goal.id, sub.id, { status: e.target.value as Status })}
                            style={{ color: statusStyles[sub.status].color }}
                          >
                            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <div className="sub-goal-info">
                            <div className="sub-goal-name">{sub.name}</div>
                            {sub.description && <div className="sub-goal-desc">{sub.description}</div>}
                          </div>
                          {sub.owner && <span className="tag" style={{ fontSize: 11 }}>{sub.owner}</span>}
                          {sub.endDate && <span className="goal-meta-item" style={{ fontSize: 11 }}>{fmtDate(sub.endDate)}</span>}
                          <button className="item-delete" onClick={() => deleteSubGoal(goal.id, sub.id)} style={{ width: 20, height: 20, fontSize: 14 }}>&times;</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Add sub-goal ── */}
                  {editingId !== goal.id && (
                    <>
                      {addingSubFor === goal.id ? (
                        <div className="sub-goal-form">
                          <div className="inline-form-row">
                            <input
                              className="input"
                              placeholder="Sub-goal name"
                              value={newSub.name}
                              onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
                              autoFocus
                              onKeyDown={(e) => e.key === "Enter" && addSubGoal(goal.id)}
                            />
                            <input
                              className="input"
                              placeholder="Owner"
                              value={newSub.owner}
                              onChange={(e) => setNewSub({ ...newSub, owner: e.target.value })}
                              style={{ width: 120, flexShrink: 0 }}
                            />
                            <input
                              className="input"
                              type="date"
                              value={newSub.endDate}
                              onChange={(e) => setNewSub({ ...newSub, endDate: e.target.value })}
                              style={{ width: 140, flexShrink: 0 }}
                            />
                          </div>
                          <input
                            className="input"
                            placeholder="Description (optional)"
                            value={newSub.description}
                            onChange={(e) => setNewSub({ ...newSub, description: e.target.value })}
                          />
                          <div className="inline-form-actions">
                            <button className="btn btn-primary btn-sm" onClick={() => addSubGoal(goal.id)}>Add</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => { setAddingSubFor(null); setNewSub(blankSub()); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="add-sub-btn"
                          onClick={() => { setAddingSubFor(goal.id); setNewSub(blankSub()); }}
                        >
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
      </div>
    </>
  );
}
