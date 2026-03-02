"use client";

import React from "react";
import StepCard from "./StepCard";
import type { BuilderStep, StrategySequenceStep } from "@/lib/types/database";

import { uid } from "./campaign-constants";

/* ── Helpers ──────────────────────────────────────────────── */
function cumulativeDays(steps: BuilderStep[]): number[] {
  let total = 0;
  return steps.map((s) => {
    total += s.delay_days ?? 0;
    return total;
  });
}

/* ── Props ────────────────────────────────────────────────── */
interface StepListProps {
  steps: BuilderStep[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onAddStep: (afterIndex: number, step: Partial<StrategySequenceStep>) => void;
  compact?: boolean;
}

export default function StepList({
  steps,
  selectedIndex,
  onSelect,
  onAddStep,
  compact,
}: StepListProps) {
  const days = cumulativeDays(steps);

  const handleAddStep = (afterIndex: number) => {
    const newStep: Partial<StrategySequenceStep> & { id: string; isNew: boolean } = {
      id: uid(),
      isNew: true,
      step_number: 0,
      delay_days: 2,
      email_type: "follow_up",
      step_type: "auto_email",
      prompt: "",
    };
    onAddStep(afterIndex, newStep);
  };

  if (steps.length === 0) {
    return (
      <div className="cb-step-list-empty">
        <p>No steps yet. Add your first step to begin building this sequence.</p>
        <button className="btn btn-primary btn-sm" onClick={() => handleAddStep(-1)}>
          + Add First Step
        </button>
      </div>
    );
  }

  return (
    <div className="cb-step-list">
      {/* Add before first */}
      <div className="cb-step-connector cb-step-connector-first">
        <button
          className="cb-step-add-btn"
          onClick={() => handleAddStep(-1)}
          title="Add step at start"
        >
          +
        </button>
      </div>

      {steps.map((step, i) => (
        <StepCard
          key={step.id}
          step={step}
          index={i}
          isSelected={selectedIndex === i}
          totalDays={days[i]}
          onClick={() => onSelect(i)}
          onAddAfter={i < steps.length - 1 ? () => handleAddStep(i) : undefined}
          compact={compact}
        />
      ))}

      {/* Add at end */}
      <div className="cb-step-connector cb-step-connector-last">
        <div className="cb-step-delay-line" />
        <button
          className="cb-step-add-btn cb-step-add-btn-end"
          onClick={() => handleAddStep(steps.length - 1)}
          title="Add step at end"
        >
          + Add Step
        </button>
      </div>
    </div>
  );
}
