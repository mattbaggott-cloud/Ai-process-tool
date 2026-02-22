"use client";

import React, { useState } from "react";
import JourneyTimeline from "./JourneyTimeline";
import GenerationProgress from "./GenerationProgress";
import CampaignMemberList from "./CampaignMemberList";
import type { CampaignStrategyGroup, StrategySequenceStep } from "@/lib/types/database";

interface VariantCounts {
  total: number;
  approved: number;
  sent: number;
}

interface StrategyGroupCardProps {
  group: CampaignStrategyGroup & { variant_counts?: VariantCounts };
  /** Is campaign currently generating? */
  isGenerating?: boolean;
  /** Whether to show the inline member list */
  showMembers?: boolean;
  /** Campaign ID (needed for member list API calls) */
  campaignId?: string;
  /** Start expanded (e.g. for single-group campaigns) */
  initialExpanded?: boolean;
  onApprove?: (groupId: string) => void;
  onReject?: (groupId: string) => void;
  onViewMembers?: (groupId: string) => void;
  onViewEmails?: (groupId: string) => void;
  onGenerate?: (groupId: string) => void;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/* ── Group icon based on index/name ── */
const GROUP_ICONS = [
  /* users */     <svg key="0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  /* target */    <svg key="1" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  /* trending */  <svg key="2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  /* star */      <svg key="3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  /* zap */       <svg key="4" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  /* heart */     <svg key="5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  /* gift */      <svg key="6" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>,
];

export default function StrategyGroupCard({
  group,
  isGenerating = false,
  showMembers = false,
  campaignId,
  initialExpanded = false,
  onApprove,
  onReject,
  onViewMembers,
  onViewEmails,
  onGenerate,
}: StrategyGroupCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);

  const steps: StrategySequenceStep[] = Array.isArray(group.sequence_steps)
    ? group.sequence_steps
    : [];

  const totalDays =
    steps.length > 0 ? Math.max(...steps.map((s) => s.delay_days)) : 0;

  const vc = group.variant_counts ?? { total: 0, approved: 0, sent: 0 };

  // Expected total: customer_count × steps — more reliable than total_emails which
  // can be stale if overwritten by a PATCH call
  const expectedTotal = group.customer_count * Math.max(steps.length, 1);

  const iconIndex = group.sort_order % GROUP_ICONS.length;

  return (
    <div
      className={`sv-group ${expanded ? "sv-group-expanded" : ""}`}
      data-status={group.status}
    >
      {/* ── Header ── */}
      <div
        className="sv-group-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="sv-group-header-left">
          <div className="sv-group-icon">
            {GROUP_ICONS[iconIndex]}
          </div>
          <div className="sv-group-meta">
            <div className="sv-group-name">{group.group_name}</div>
            <div className="sv-group-stats">
              {onViewMembers ? (
                <span
                  className="sv-group-customer-link"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!expanded) setExpanded(true);
                    onViewMembers(group.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      if (!expanded) setExpanded(true);
                      onViewMembers(group.id);
                    }
                  }}
                >
                  {group.customer_count.toLocaleString()} customers
                </span>
              ) : (
                <span>{group.customer_count.toLocaleString()} customers</span>
              )}
              <span className="sv-group-stats-sep" />
              <span>
                {steps.length} email{steps.length !== 1 ? "s" : ""}
                {totalDays > 0 && ` over ${totalDays}d`}
              </span>
            </div>
          </div>
        </div>
        <div className="sv-group-header-right">
          <span className={`sv-group-status-pill sv-group-status-${group.status}`}>
            {capitalise(group.status)}
          </span>
          <button
            className="sv-expand-btn"
            title={expanded ? "Collapse" : "Expand"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── AI Reasoning ── */}
      {group.ai_reasoning && (
        <div className="sv-reasoning">
          <svg className="sv-reasoning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="sv-reasoning-text">{group.ai_reasoning}</span>
        </div>
      )}

      {/* ── Journey Timeline ── */}
      <div className="sv-timeline-wrap">
        <JourneyTimeline steps={steps} groupStatus={group.status} />
      </div>

      {/* ── Generation Progress (when generating) ── */}
      {isGenerating && group.status === "generating" && (
        <div className="sv-group-progress">
          <GenerationProgress
            current={vc.total}
            total={expectedTotal}
            label={`Generating emails for ${group.group_name}`}
            size="sm"
          />
        </div>
      )}

      {/* ── Expanded Content ── */}
      {expanded && (
        <div className="sv-group-body">
          {/* Group description */}
          {group.group_description && (
            <div className="sv-group-desc">
              {group.group_description}
            </div>
          )}

          {/* Sequence Steps Detail */}
          <div className="sv-steps-section">
            <div className="sv-steps-title">Email Sequence</div>
            <div className="sv-steps-list">
              {steps.map((step) => (
                <div key={step.step_number} className="sv-step-card">
                  <div className="sv-step-indicator">
                    <div className="sv-step-num">{step.step_number}</div>
                    <div className="sv-step-day-badge">Day {step.delay_days}</div>
                  </div>
                  <div className="sv-step-content">
                    <div className="sv-step-top">
                      <span className="sv-step-type-badge">
                        {capitalise(step.email_type)}
                      </span>
                    </div>
                    <div className="sv-step-prompt-text">{step.prompt}</div>
                    {step.subject_hint && (
                      <div className="sv-step-subject">
                        <span className="sv-step-subject-label">Subject:</span>{" "}
                        {step.subject_hint}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Variant counts */}
          {vc.total > 0 && (
            <div className="sv-variant-summary">
              <span>{vc.total} generated</span>
              <span>{vc.approved} approved</span>
              {vc.sent > 0 && <span>{vc.sent} sent</span>}
            </div>
          )}

          {/* Actions */}
          <div className="sv-group-actions">
            {onViewMembers && (
              <button
                className="sv-btn sv-btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewMembers(group.id);
                }}
              >
                {showMembers ? "Hide Members" : `View ${group.customer_count} Members`}
              </button>
            )}
            {/* Per-group Generate button */}
            {onGenerate && vc.total === 0 && group.status !== "generating" && (
              <button
                className="sv-btn sv-btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerate(group.id);
                }}
                disabled={isGenerating}
              >
                Generate Emails ({expectedTotal})
              </button>
            )}
            {onViewEmails && vc.total > 0 && (
              <button
                className="sv-btn sv-btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewEmails(group.id);
                }}
              >
                Review Emails ({vc.total})
              </button>
            )}
            {group.status === "draft" && onApprove && (
              <button
                className="sv-btn sv-btn-approve"
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(group.id);
                }}
              >
                Approve Group
              </button>
            )}
            {group.status === "draft" && onReject && (
              <button
                className="sv-btn sv-btn-reject"
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(group.id);
                }}
              >
                Remove Group
              </button>
            )}
          </div>

          {/* Inline Member List */}
          {showMembers && campaignId && (
            <CampaignMemberList
              campaignId={campaignId}
              groupId={group.id}
              customerCount={group.customer_count}
              onClose={() => onViewMembers?.(group.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
