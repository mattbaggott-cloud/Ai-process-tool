"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOrg } from "@/context/OrgContext";
import { STEP_TYPE_META, STATUS_BADGE_CLASS, truncate } from "./campaign-constants";
import type { CampaignTask } from "@/lib/types/database";

/* ── Props ────────────────────────────────────────────────── */
type TaskWithCampaign = CampaignTask & {
  email_campaigns?: { id?: string; name?: string; campaign_category?: string };
};

interface TaskDetailDrawerProps {
  task: TaskWithCampaign;
  onClose: () => void;
  onUpdate: () => void;
}

interface CustomerInfo {
  name: string;
  email: string;
  orders_count: number;
  total_spent: number;
  lifecycle_stage: string;
  last_order_date: string | null;
}

/* ── Action button config ────────────────────────────────── */
const ACTION_BUTTONS: Record<string, { label: string; action: "start" | "complete" | "skip"; variant: string }[]> = {
  pending: [
    { label: "Start", action: "start", variant: "btn btn-secondary" },
    { label: "✓ Complete", action: "complete", variant: "btn btn-primary" },
    { label: "Skip", action: "skip", variant: "btn btn-secondary" },
  ],
  in_progress: [
    { label: "✓ Complete", action: "complete", variant: "btn btn-primary" },
    { label: "Skip", action: "skip", variant: "btn btn-secondary" },
  ],
};

export default function TaskDetailDrawer({ task, onClose, onUpdate }: TaskDetailDrawerProps) {
  const { orgId } = useOrg();
  const [notes, setNotes] = useState(task.notes ?? "");
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [acting, setActing] = useState(false);

  /* ── Load customer enrichment ───────────────────────────── */
  useEffect(() => {
    if (!task.ecom_customer_id || !orgId) return;
    const supabase = createClient();
    supabase
      .from("ecom_customers")
      .select("first_name, last_name, email, orders_count, total_spent, lifecycle_stage, last_order_date")
      .eq("id", task.ecom_customer_id)
      .eq("org_id", orgId)
      .single()
      .then(({ data }) => {
        if (data) {
          setCustomer({
            name: [data.first_name, data.last_name].filter(Boolean).join(" ") || "Unknown",
            email: data.email ?? "",
            orders_count: data.orders_count ?? 0,
            total_spent: data.total_spent ?? 0,
            lifecycle_stage: data.lifecycle_stage ?? "unknown",
            last_order_date: data.last_order_date ?? null,
          });
        }
      });
  }, [task.ecom_customer_id, orgId]);

  /* ── Action handler ─────────────────────────────────────── */
  const handleAction = async (action: "start" | "complete" | "skip") => {
    setActing(true);
    try {
      const body: Record<string, unknown> = { taskId: task.id, action };
      if ((action === "complete" || action === "skip") && notes) body.notes = notes;

      const res = await fetch(`/api/campaigns/${task.campaign_id}/tasks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onUpdate();
      }
    } catch {
      /* silent */
    } finally {
      setActing(false);
    }
  };

  /* ── Keyboard: Escape to close ──────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stepLabel = STEP_TYPE_META[task.step_type ?? "custom_task"]?.label ?? "Task";
  const actions = ACTION_BUTTONS[task.status] ?? [];

  return (
    <div className="cb-drawer-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        {/* Header */}
        <div className="cb-drawer-header">
          <h3 className="cb-drawer-title">
            {task.instructions
              ? truncate(task.instructions, 60)
              : `Step ${task.step_number} — ${stepLabel}`}
          </h3>
          <button className="cb-editor-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Campaign context */}
        <div className="cb-drawer-section">
          <div className="cb-drawer-section-label">Campaign</div>
          <div className="cb-drawer-campaign-name">
            {task.email_campaigns?.name ?? "Unknown Campaign"}
          </div>
          <div className="cb-drawer-step-pos">
            Step {task.step_number} — {stepLabel}
          </div>
          <span className={`campaign-badge ${STATUS_BADGE_CLASS[task.status] ?? "campaign-badge-gray"}`}>
            {task.status.replace(/_/g, " ")}
          </span>
        </div>

        {/* Customer enrichment */}
        {customer && (
          <div className="cb-drawer-section">
            <div className="cb-drawer-section-label">Customer</div>
            <div className="cb-drawer-customer-name">{customer.name}</div>
            <div className="cb-drawer-customer-email">{customer.email}</div>
            <div className="cb-drawer-customer-stats">
              <span>{customer.orders_count} orders</span>
              <span>·</span>
              <span>${customer.total_spent.toLocaleString()} lifetime</span>
            </div>
            <div className="cb-drawer-customer-meta">
              <span className="tag">{customer.lifecycle_stage}</span>
              {customer.last_order_date && (
                <span className="cb-drawer-last-order">
                  Last order: {new Date(customer.last_order_date).toLocaleDateString("en-US", {
                    month: "short", day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Instructions */}
        {task.instructions && (
          <div className="cb-drawer-section">
            <div className="cb-drawer-section-label">Instructions</div>
            <div className="cb-drawer-instructions">{task.instructions}</div>
          </div>
        )}

        {/* Due date */}
        {task.due_at && (
          <div className="cb-drawer-section">
            <div className="cb-drawer-section-label">Due Date</div>
            <div className="cb-drawer-due">
              {new Date(task.due_at).toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric", year: "numeric",
              })}
              {new Date(task.due_at) < new Date() && task.status === "pending" && (
                <span className="cb-drawer-overdue"> — Overdue</span>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="cb-drawer-section">
          <div className="cb-drawer-section-label">Notes</div>
          <textarea
            className="cb-editor-textarea"
            rows={3}
            placeholder="Add notes about this task..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Task notes"
          />
        </div>

        {/* Actions */}
        <div className="cb-drawer-actions">
          {actions.length > 0 ? (
            actions.map((btn) => (
              <button
                key={btn.action}
                className={btn.variant}
                onClick={() => handleAction(btn.action)}
                disabled={acting}
              >
                {btn.label}
              </button>
            ))
          ) : (
            <div className="cb-drawer-done-msg">
              This task has been {task.status}.
              {task.completed_at && (
                <span> on {new Date(task.completed_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric",
                })}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
