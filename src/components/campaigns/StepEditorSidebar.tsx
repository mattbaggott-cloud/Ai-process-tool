"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { BuilderStep, StepType } from "@/lib/types/database";

/* ── Options ──────────────────────────────────────────────── */
const STEP_TYPES: { value: StepType; label: string }[] = [
  { value: "auto_email",        label: "Auto Email" },
  { value: "manual_email",      label: "Manual Email" },
  { value: "phone_call",        label: "Phone Call" },
  { value: "linkedin_view",     label: "LinkedIn View" },
  { value: "linkedin_connect",  label: "LinkedIn Connect" },
  { value: "linkedin_message",  label: "LinkedIn Message" },
  { value: "custom_task",       label: "Custom Task" },
];

const CHANNELS: { value: string; label: string }[] = [
  { value: "gmail",    label: "Gmail" },
  { value: "outreach", label: "Outreach" },
  { value: "klaviyo",  label: "Klaviyo" },
];

const EMAIL_TYPES: { value: string; label: string }[] = [
  { value: "initial",      label: "Initial Outreach" },
  { value: "follow_up",    label: "Follow Up" },
  { value: "breakup",      label: "Break Up" },
  { value: "promotional",  label: "Promotional" },
  { value: "educational",  label: "Educational" },
  { value: "re_engagement",label: "Re-engagement" },
];

/* ── Props ────────────────────────────────────────────────── */
interface StepEditorSidebarProps {
  step: BuilderStep;
  stepIndex: number;
  onUpdate: (updates: Partial<BuilderStep>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function StepEditorSidebar({
  step,
  stepIndex,
  onUpdate,
  onDelete,
  onClose,
}: StepEditorSidebarProps) {
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmailStep = step.step_type === "auto_email" || step.step_type === "manual_email";
  const isManualStep = step.step_type !== "auto_email";

  /* ── Auto-save indicator ──────────────────────────────── */
  const showSaved = useCallback(() => {
    setSaved(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  /* ── Field change handler ──────────────────────────────── */
  const handleChange = (field: string, value: unknown) => {
    onUpdate({ [field]: value });
    showSaved();
  };

  /* ── Delete confirmation ──────────────────────────────── */
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="cb-editor-sidebar">
      {/* Header */}
      <div className="cb-editor-header">
        <h3 className="cb-editor-title">
          Step {stepIndex + 1}
          {step.subject_hint && <span className="cb-editor-subtitle">: {step.subject_hint}</span>}
        </h3>
        <div className="cb-editor-header-right">
          {saved && <span className="cb-editor-saved">Saved \u2713</span>}
          <button className="cb-editor-close" onClick={onClose} title="Close" aria-label="Close editor">
            ✕
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="cb-editor-fields">
        {/* Step Type */}
        <div className="cb-editor-field">
          <label className="cb-editor-label">Step Type</label>
          <select
            className="cb-editor-select"
            value={step.step_type ?? "auto_email"}
            onChange={(e) => handleChange("step_type", e.target.value)}
          >
            {STEP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Channel (email steps only) */}
        {isEmailStep && (
          <div className="cb-editor-field">
            <label className="cb-editor-label">Channel</label>
            <select
              className="cb-editor-select"
              value={step.channel ?? "gmail"}
              onChange={(e) => handleChange("channel", e.target.value)}
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Email Type (email steps only) */}
        {isEmailStep && (
          <div className="cb-editor-field">
            <label className="cb-editor-label">Email Type</label>
            <select
              className="cb-editor-select"
              value={step.email_type ?? "follow_up"}
              onChange={(e) => handleChange("email_type", e.target.value)}
            >
              {EMAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Timing */}
        <div className="cb-editor-field">
          <label className="cb-editor-label">Timing</label>
          <div className="cb-editor-timing-row">
            <span className="cb-editor-timing-prefix">Wait</span>
            <input
              type="number"
              className="cb-editor-input cb-editor-input-sm"
              min={0}
              max={365}
              value={step.delay_days ?? 0}
              onChange={(e) => handleChange("delay_days", parseInt(e.target.value) || 0)}
            />
            <span className="cb-editor-timing-suffix">days</span>
          </div>
        </div>

        {/* Subject Line Hint */}
        {isEmailStep && (
          <div className="cb-editor-field">
            <label className="cb-editor-label">Subject Line Hint</label>
            <input
              type="text"
              className="cb-editor-input"
              placeholder="Suggested subject direction..."
              value={step.subject_hint ?? ""}
              onChange={(e) => handleChange("subject_hint", e.target.value)}
            />
          </div>
        )}

        {/* Prompt / Instructions */}
        <div className="cb-editor-field">
          <label className="cb-editor-label">
            {isManualStep ? "Task Instructions" : "AI Prompt"}
          </label>
          <textarea
            className="cb-editor-textarea"
            rows={5}
            placeholder={isManualStep
              ? "Instructions for the rep completing this task..."
              : "What should the AI write about in this email..."}
            value={isManualStep ? (step.task_instructions ?? "") : (step.prompt ?? "")}
            onChange={(e) => handleChange(
              isManualStep ? "task_instructions" : "prompt",
              e.target.value,
            )}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="cb-editor-actions">
        {confirmDelete ? (
          <div className="cb-editor-confirm-delete">
            <span>Delete this step?</span>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              Confirm Delete
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="cb-editor-delete-btn"
            onClick={() => setConfirmDelete(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete Step
          </button>
        )}
      </div>
    </div>
  );
}
