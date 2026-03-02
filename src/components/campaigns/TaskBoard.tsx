"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/context/OrgContext";
import TaskCard from "./TaskCard";
import { STATUS_BADGE_CLASS, truncate } from "./campaign-constants";
import type { CampaignTask } from "@/lib/types/database";

/* ── Types ────────────────────────────────────────────────── */
type TaskWithCampaign = CampaignTask & {
  email_campaigns?: { id?: string; name?: string; campaign_category?: string; status?: string };
};

type ViewMode = "list" | "board";

const BOARD_COLUMNS = [
  { key: "pending",     label: "Pending",     color: "#f59e0b" },
  { key: "in_progress", label: "In Progress", color: "#3b82f6" },
  { key: "completed",   label: "Completed",   color: "#10b981" },
  { key: "skipped",     label: "Skipped",     color: "#9ca3af" },
];

const STEP_TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "auto_email", label: "Auto Email" },
  { value: "manual_email", label: "Manual Email" },
  { value: "phone_call", label: "Phone Call" },
  { value: "linkedin_view", label: "LinkedIn View" },
  { value: "linkedin_connect", label: "LinkedIn Connect" },
  { value: "linkedin_message", label: "LinkedIn Message" },
  { value: "custom_task", label: "Custom Task" },
];

/* ── Props ────────────────────────────────────────────────── */
interface TaskBoardProps {
  campaignId?: string;        // if provided, scoped to one campaign
  onTaskSelect?: (task: TaskWithCampaign) => void;
}

export default function TaskBoard({ campaignId, onTaskSelect }: TaskBoardProps) {
  const { orgId } = useOrg();
  const [tasks, setTasks] = useState<TaskWithCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  /* ── Fetch tasks ────────────────────────────────────────── */
  const loadTasks = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("assigned_to", "all"); // show all tasks
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("step_type", typeFilter);

    const base = campaignId
      ? `/api/campaigns/${campaignId}/tasks`
      : "/api/tasks";

    try {
      const res = await fetch(`${base}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [orgId, campaignId, page, statusFilter, typeFilter]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  /* ── Quick action handler ───────────────────────────────── */
  const handleQuickAction = async (task: TaskWithCampaign, action: "complete" | "skip") => {
    try {
      const res = await fetch(`/api/campaigns/${task.campaign_id}/tasks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, action }),
      });
      if (res.ok) loadTasks();
    } catch {
      /* silent */
    }
  };

  /* ── Stats ──────────────────────────────────────────────── */
  const stats = {
    pending: tasks.filter((t) => t.status === "pending").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    total,
  };

  /* ── Board view ─────────────────────────────────────────── */
  const renderBoard = () => (
    <div className="cb-task-board-columns">
      {BOARD_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div key={col.key} className="cb-task-board-col">
            <div className="cb-task-board-col-header" style={{ borderTopColor: col.color }}>
              <span>{col.label}</span>
              <span className="cb-task-board-col-count">{colTasks.length}</span>
            </div>
            <div className="cb-task-board-col-cards">
              {colTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskSelect?.(task)}
                  onQuickAction={(a) => handleQuickAction(task, a)}
                  compact
                />
              ))}
              {colTasks.length === 0 && (
                <div className="cb-task-board-empty">No tasks</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ── List view ──────────────────────────────────────────── */
  const renderList = () => (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Type</th>
            {!campaignId && <th>Campaign</th>}
            <th>Customer</th>
            <th>Status</th>
            <th>Due</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              className="crm-table-row crm-table-row-clickable"
              onClick={() => onTaskSelect?.(task)}
            >
              <td className="crm-cell-name">
                {task.instructions
                  ? truncate(task.instructions, 50)
                  : `Step ${task.step_number}`}
              </td>
              <td>
                <span className="tag">{task.step_type?.replace(/_/g, " ") ?? "task"}</span>
              </td>
              {!campaignId && <td>{task.email_campaigns?.name ?? "\u2014"}</td>}
              <td>{task.customer_email ?? "\u2014"}</td>
              <td>
                <span className={`campaign-badge ${STATUS_BADGE_CLASS[task.status] ?? "campaign-badge-gray"}`}>
                  {task.status.replace(/_/g, " ")}
                </span>
              </td>
              <td>
                {task.due_at
                  ? new Date(task.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "\u2014"}
              </td>
              <td>
                {task.status === "pending" && (
                  <div className="cb-task-row-actions">
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={(e) => { e.stopPropagation(); handleQuickAction(task, "complete"); }}
                    >
                      \u2713
                    </button>
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={(e) => { e.stopPropagation(); handleQuickAction(task, "skip"); }}
                    >
                      \u2715
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && !loading && (
        <div className="crm-loading" style={{ textAlign: "center", padding: 40 }}>
          No tasks found
        </div>
      )}
    </div>
  );

  return (
    <div className="cb-task-board">
      {/* Toolbar */}
      <div className="cb-task-toolbar">
        <div className="cb-task-toolbar-left">
          <div className="cb-task-stats">
            <span className="cb-task-stat">
              <strong>{stats.pending}</strong> pending
            </span>
            <span className="cb-task-stat">
              <strong>{stats.in_progress}</strong> in progress
            </span>
            <span className="cb-task-stat">
              <strong>{stats.completed}</strong> completed
            </span>
          </div>
        </div>
        <div className="cb-task-toolbar-right">
          <select
            className="cb-editor-select cb-editor-select-sm"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            aria-label="Filter by type"
          >
            {STEP_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="cb-editor-select cb-editor-select-sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            {BOARD_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <div className="cb-task-view-toggle">
            <button
              className={`cb-task-view-btn ${viewMode === "list" ? "cb-task-view-btn-active" : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button
              className={`cb-task-view-btn ${viewMode === "board" ? "cb-task-view-btn-active" : ""}`}
              onClick={() => setViewMode("board")}
              title="Board view"
              aria-label="Board view"
              aria-pressed={viewMode === "board"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="crm-loading">Loading tasks...</div>
      ) : viewMode === "board" ? (
        renderBoard()
      ) : (
        renderList()
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="campaign-pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>Page {page} of {Math.ceil(total / limit)}</span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page * limit >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
