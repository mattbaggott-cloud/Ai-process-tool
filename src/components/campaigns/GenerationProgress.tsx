"use client";

import React from "react";

interface GenerationProgressProps {
  /** Current number of items generated */
  current: number;
  /** Total expected items */
  total: number;
  /** Optional label */
  label?: string;
  /** Optional size variant */
  size?: "sm" | "md" | "lg";
  /** Show percentage text */
  showPercent?: boolean;
  /** Show count text */
  showCount?: boolean;
}

export default function GenerationProgress({
  current,
  total,
  label,
  size = "md",
  showPercent = true,
  showCount = true,
}: GenerationProgressProps) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const isComplete = current >= total && total > 0;

  return (
    <div className={`sv-progress sv-progress-${size} ${isComplete ? "sv-progress-complete" : ""}`}>
      {label && <div className="sv-progress-label">{label}</div>}
      <div className="sv-progress-bar-track">
        <div
          className="sv-progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="sv-progress-info">
        {showCount && (
          <span className="sv-progress-count">
            {current.toLocaleString()}/{total.toLocaleString()}
          </span>
        )}
        {showPercent && (
          <span className="sv-progress-pct">{pct}%</span>
        )}
      </div>
    </div>
  );
}
