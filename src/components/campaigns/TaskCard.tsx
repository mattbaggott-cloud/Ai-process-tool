"use client";

import React from "react";
import type { CampaignTask } from "@/lib/types/database";

import { STEP_TYPE_META, truncate } from "./campaign-constants";

const STATUS_CLASSES: Record<string, string> = {
  pending:     "cb-task-status-pending",
  in_progress: "cb-task-status-active",
  completed:   "cb-task-status-done",
  skipped:     "cb-task-status-skipped",
};

/* ── Props ────────────────────────────────────────────────── */
interface TaskCardProps {
  task: CampaignTask & { email_campaigns?: { name?: string; campaign_category?: string } };
  onClick: () => void;
  onQuickAction?: (action: "complete" | "skip") => void;
  compact?: boolean;
}

export default function TaskCard({ task, onClick, onQuickAction, compact }: TaskCardProps) {
  const icon = STEP_TYPE_META[task.step_type ?? "custom_task"]?.icon ?? "☑️";
  const statusClass = STATUS_CLASSES[task.status] ?? "";
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status === "pending";

  const dueLabel = task.due_at
    ? new Date(task.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div
      className={`cb-task-card ${statusClass} ${isOverdue ? "cb-task-card-overdue" : ""}`}
      onClick={onClick}
    >
      <div className="cb-task-card-top">
        <span className="cb-task-icon">{icon}</span>
        <span className="cb-task-title">
          {task.instructions
            ? truncate(task.instructions, 60)
            : `Step ${task.step_number} — ${task.step_type?.replace(/_/g, " ") ?? "Task"}`}
        </span>
      </div>

      {!compact && (
        <div className="cb-task-card-meta">
          {task.customer_email && (
            <span className="cb-task-customer">{task.customer_email}</span>
          )}
          {task.email_campaigns?.name && (
            <span className="cb-task-campaign">{task.email_campaigns.name}</span>
          )}
          {dueLabel && (
            <span className={`cb-task-due ${isOverdue ? "cb-task-due-overdue" : ""}`}>
              {isOverdue ? "\u26A0 " : ""}{dueLabel}
            </span>
          )}
        </div>
      )}

      {/* Quick actions on hover */}
      {onQuickAction && task.status === "pending" && (
        <div className="cb-task-quick-actions">
          <button
            className="cb-task-quick-btn cb-task-quick-complete"
            onClick={(e) => { e.stopPropagation(); onQuickAction("complete"); }}
            title="Complete"
            aria-label="Complete task"
          >
            ✓
          </button>
          <button
            className="cb-task-quick-btn cb-task-quick-skip"
            onClick={(e) => { e.stopPropagation(); onQuickAction("skip"); }}
            title="Skip"
            aria-label="Skip task"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
