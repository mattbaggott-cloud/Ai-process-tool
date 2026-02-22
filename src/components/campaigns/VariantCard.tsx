"use client";

import React from "react";
import type { EmailCustomerVariant } from "@/lib/types/database";

/* ── Status badge colors ───────────────────────────────── */
const statusColors: Record<string, string> = {
  draft: "var(--color-gray-400)",
  approved: "var(--color-success)",
  edited: "var(--color-primary)",
  rejected: "var(--color-error)",
  sending: "var(--color-warning, #f59e0b)",
  sent: "var(--color-success)",
  failed: "var(--color-error)",
};

/* ── Context pill renderer ──────────────────────────────── */
function ContextPills({ ctx }: { ctx: Record<string, unknown> }) {
  const pills: { label: string; value: string }[] = [];

  if (ctx.lifecycle_stage) {
    pills.push({ label: "Lifecycle", value: String(ctx.lifecycle_stage) });
  }
  if (ctx.rfm_segment) {
    pills.push({ label: "RFM", value: String(ctx.rfm_segment) });
  }
  if (ctx.total_orders !== undefined) {
    pills.push({ label: "Orders", value: String(ctx.total_orders) });
  }
  if (ctx.total_revenue !== undefined) {
    pills.push({
      label: "Revenue",
      value: `$${Number(ctx.total_revenue).toLocaleString()}`,
    });
  }

  if (pills.length === 0) return null;

  return (
    <div className="campaign-variant-pills">
      {pills.map((p) => (
        <span key={p.label} className="campaign-variant-pill">
          {p.label}: {p.value}
        </span>
      ))}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────── */
interface VariantCardProps {
  variant: EmailCustomerVariant;
  isActive: boolean;
  onClick: () => void;
}

export default function VariantCard({
  variant,
  isActive,
  onClick,
}: VariantCardProps) {
  const statusColor = statusColors[variant.status] || "var(--color-gray-400)";
  const displayName =
    variant.customer_name || variant.customer_email || "Unknown";
  const subject =
    (variant.edited_content as Record<string, string> | null)?.subject_line ||
    variant.subject_line ||
    "(no subject)";

  return (
    <div
      className={`campaign-variant-card ${isActive ? "campaign-variant-card-active" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Status dot + customer info */}
      <div className="campaign-variant-header">
        <span
          className="campaign-variant-status-dot"
          style={{ backgroundColor: statusColor }}
          title={variant.status}
        />
        <div className="campaign-variant-customer">
          <span className="campaign-variant-name">{displayName}</span>
          {variant.customer_name && (
            <span className="campaign-variant-email">
              {variant.customer_email}
            </span>
          )}
        </div>
        <span className="campaign-variant-status-badge" data-status={variant.status}>
          {variant.status}
        </span>
      </div>

      {/* Subject line */}
      <div className="campaign-variant-subject" title={subject}>
        {subject}
      </div>

      {/* Context pills */}
      <ContextPills ctx={variant.personalization_context || {}} />
    </div>
  );
}
