"use client";

import React, { useState } from "react";
import type { ContactStatus, DealStage, ActivityType, CompanySize } from "@/lib/types/database";

/* ── Status Badge ──────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  lead: "#2563eb",
  active: "#059669",
  inactive: "#6b7280",
  churned: "#dc2626",
  // deal stages
  qualified: "#7c3aed",
  proposal: "#d97706",
  negotiation: "#ea580c",
  won: "#16a34a",
  lost: "#dc2626",
};

const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  active: "Active",
  inactive: "Inactive",
  churned: "Churned",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export function StatusBadge({ status }: { status: ContactStatus | DealStage | string }) {
  const color = STATUS_COLORS[status] ?? "#6b7280";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      className="crm-status-badge"
      style={{ backgroundColor: color + "14", color, borderColor: color + "30" }}
    >
      {label}
    </span>
  );
}

/* ── Company Size Badge ────────────────────────────────── */

const SIZE_LABELS: Record<string, string> = {
  startup: "Startup",
  small: "Small",
  medium: "Medium",
  large: "Large",
  enterprise: "Enterprise",
};

export function SizeBadge({ size }: { size: CompanySize }) {
  if (!size) return null;
  return (
    <span className="crm-size-badge">{SIZE_LABELS[size] ?? size}</span>
  );
}

/* ── Activity Type Icon ────────────────────────────────── */

const ACTIVITY_ICONS: Record<ActivityType, React.ReactNode> = {
  call: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.7a.5.5 0 0 1 .47.33l.9 2.34a.5.5 0 0 1-.13.56L5 6.5A6.5 6.5 0 0 0 7.5 9l1.27-1.44a.5.5 0 0 1 .56-.13l2.34.9a.5.5 0 0 1 .33.47v1.7a1.5 1.5 0 0 1-1.5 1.5H10A8 8 0 0 1 2 4V3.5Z" />
    </svg>
  ),
  email: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="11" height="8" rx="1" /><path d="M1.5 4l5.5 4 5.5-4" />
    </svg>
  ),
  meeting: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4v3l2 1.5" />
    </svg>
  ),
  note: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2h8a1 1 0 0 1 1 1v7.59a1 1 0 0 1-.29.7l-2.42 2.42a1 1 0 0 1-.7.29H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 9v4" /><path d="M5 5h4M5 7.5h2" />
    </svg>
  ),
  task: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M4.5 7l1.5 1.5 3-3" />
    </svg>
  ),
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  call: "#2563eb",
  email: "#7c3aed",
  meeting: "#059669",
  note: "#6b7280",
  task: "#d97706",
};

export function ActivityIcon({ type }: { type: ActivityType }) {
  return (
    <span
      className="crm-activity-icon"
      style={{ color: ACTIVITY_COLORS[type] ?? "#6b7280" }}
    >
      {ACTIVITY_ICONS[type] ?? ACTIVITY_ICONS.note}
    </span>
  );
}

export function ActivityLabel({ type }: { type: ActivityType }) {
  const labels: Record<ActivityType, string> = {
    call: "Call",
    email: "Email",
    meeting: "Meeting",
    note: "Note",
    task: "Task",
  };
  return <span>{labels[type] ?? type}</span>;
}

/* ── Deal Value Display ────────────────────────────────── */

export function DealValue({ value, currency = "USD" }: { value: number; currency?: string }) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return <span className="crm-deal-value">{formatted}</span>;
}

/* ── CRM Form Field ────────────────────────────────────── */

export function CrmFormField({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="crm-form-field">
      <label className="crm-form-label">
        {label}
        {required && <span className="crm-required">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ── Stage probability defaults ────────────────────────── */

export const STAGE_PROBABILITY: Record<string, number> = {
  lead: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export const DEAL_STAGES: { value: string; label: string; color: string }[] = [
  { value: "lead", label: "Lead", color: "#2563eb" },
  { value: "qualified", label: "Qualified", color: "#7c3aed" },
  { value: "proposal", label: "Proposal", color: "#d97706" },
  { value: "negotiation", label: "Negotiation", color: "#ea580c" },
  { value: "won", label: "Won", color: "#16a34a" },
  { value: "lost", label: "Lost", color: "#dc2626" },
];

/* ── Format currency helper ────────────────────────────── */

export function formatCurrency(value: number | null | undefined, currency = "USD"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/* ── Asset Status Badge ────────────────────────────────── */

const ASSET_STATUS_COLORS: Record<string, string> = {
  active: "#059669",
  expired: "#d97706",
  cancelled: "#6b7280",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function AssetStatusBadge({ status }: { status: string }) {
  const color = ASSET_STATUS_COLORS[status] ?? "#6b7280";
  const label = ASSET_STATUS_LABELS[status] ?? status;
  return (
    <span
      className="crm-status-badge"
      style={{ backgroundColor: color + "14", color, borderColor: color + "30" }}
    >
      {label}
    </span>
  );
}

/* ── Close Reason Modal ────────────────────────────────── */

export interface CloseReasonResult {
  close_reason: string;
  lost_to: string;
}

export function CloseReasonModal({
  stage,
  onConfirm,
  onCancel,
}: {
  stage: "won" | "lost";
  onConfirm: (result: CloseReasonResult) => void;
  onCancel: () => void;
}) {
  const [closeReason, setCloseReason] = useState("");
  const [lostTo, setLostTo] = useState("");

  return (
    <div className="crm-close-modal-overlay" onClick={onCancel}>
      <div className="crm-close-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{stage === "won" ? "Deal Won!" : "Deal Lost"}</h3>
        <div className="crm-close-modal-fields">
          <div>
            <label className="crm-form-label">
              {stage === "won" ? "Why did you win this deal?" : "Why was this deal lost?"}
            </label>
            <input
              className="crm-input"
              placeholder={stage === "won" ? "e.g., Best product fit, pricing" : "e.g., Price, competitor, timing"}
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              autoFocus
            />
          </div>
          {stage === "lost" && (
            <div>
              <label className="crm-form-label">Lost to competitor (optional)</label>
              <input
                className="crm-input"
                placeholder="e.g., Salesforce, HubSpot"
                value={lostTo}
                onChange={(e) => setLostTo(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="crm-close-modal-actions">
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onConfirm({ close_reason: closeReason.trim(), lost_to: lostTo.trim() })}
          >
            {stage === "won" ? "Mark as Won" : "Mark as Lost"}
          </button>
        </div>
      </div>
    </div>
  );
}
