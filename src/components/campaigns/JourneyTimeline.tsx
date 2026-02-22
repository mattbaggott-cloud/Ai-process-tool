"use client";

import React from "react";
import type { StrategySequenceStep } from "@/lib/types/database";

interface JourneyTimelineProps {
  steps: StrategySequenceStep[];
  /** Overall group status — controls step dot colors */
  groupStatus?: string;
  /** Optional compact mode for smaller displays */
  compact?: boolean;
}

const stepStatusColor: Record<string, string> = {
  draft: "sv-tl-dot-gray",
  approved: "sv-tl-dot-green",
  generating: "sv-tl-dot-blue sv-tl-dot-pulse",
  review: "sv-tl-dot-yellow",
  sent: "sv-tl-dot-green",
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

export default function JourneyTimeline({
  steps,
  groupStatus = "draft",
  compact = false,
}: JourneyTimelineProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className="sv-timeline-empty">No sequence steps defined</div>
    );
  }

  const dotClass = stepStatusColor[groupStatus] || "sv-tl-dot-gray";

  return (
    <div className={`sv-timeline ${compact ? "sv-timeline-compact" : ""}`}>
      {steps.map((step, i) => (
        <React.Fragment key={step.step_number}>
          {/* Connecting line before (except first) */}
          {i > 0 && <div className="sv-tl-line" />}

          {/* Step dot + label */}
          <div className="sv-tl-step">
            <div className={`sv-tl-dot ${dotClass}`}>
              {step.step_number}
            </div>
            <div className="sv-tl-label">
              <span className="sv-tl-day">
                Day {step.delay_days}
              </span>
              <span className="sv-tl-type">
                {capitalise(step.email_type)}
              </span>
              {step.subject_hint && !compact && (
                <span className="sv-tl-hint" title={step.subject_hint}>
                  {step.subject_hint}
                </span>
              )}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
