"use client";

import React from "react";
import type { BuilderStep } from "@/lib/types/database";

import { STEP_TYPE_META, CHANNEL_META, truncate } from "./campaign-constants";

interface StepCardProps {
  step: BuilderStep;
  index: number;
  isSelected: boolean;
  totalDays: number;
  onClick: () => void;
  onAddAfter?: () => void;
  compact?: boolean;
}

export default function StepCard({
  step,
  index,
  isSelected,
  totalDays,
  onClick,
  onAddAfter,
  compact,
}: StepCardProps) {
  const stepType = STEP_TYPE_META[step.step_type ?? "auto_email"] ?? STEP_TYPE_META.auto_email;
  const channel = step.channel ? CHANNEL_META[step.channel] : null;
  const isManual = step.step_type && !step.step_type.startsWith("auto");
  const prompt = step.prompt || step.task_instructions || "";
  const preview = truncate(prompt, 80);

  return (
    <>
      <div
        className={`cb-step-card ${isSelected ? "cb-step-card-selected" : ""} ${isManual ? "cb-step-card-manual" : ""}`}
        onClick={onClick}
      >
        {/* Drag handle */}
        <div className="cb-step-grip" title="Drag to reorder">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" opacity={0.3}>
            <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
          </svg>
        </div>

        {/* Step number circle */}
        <div className={`cb-step-num ${step.isNew ? "cb-step-num-new" : ""}`}>
          {index + 1}
        </div>

        {/* Content */}
        <div className="cb-step-content">
          <div className="cb-step-top-row">
            <span className="cb-step-type-badge">
              {stepType.icon} {stepType.label}
            </span>
            {channel && (
              <span className="cb-step-channel" style={{ color: channel.color }}>
                via {channel.label}
              </span>
            )}
            <span className="cb-step-timing">Day {totalDays}</span>
          </div>
          {step.subject_hint && (
            <div className="cb-step-subject">{step.subject_hint}</div>
          )}
          {!compact && preview && (
            <div className="cb-step-preview">{preview}</div>
          )}
        </div>
      </div>

      {/* Delay connector + Add button */}
      {onAddAfter && (
        <div className="cb-step-connector">
          <div className="cb-step-delay-line" />
          {step.delay_days > 0 && (
            <span className="cb-step-delay-label">
              wait {step.delay_days} day{step.delay_days !== 1 ? "s" : ""}
            </span>
          )}
          <button
            className="cb-step-add-btn"
            onClick={(e) => { e.stopPropagation(); onAddAfter(); }}
            title="Add step here"
          >
            +
          </button>
        </div>
      )}
    </>
  );
}
