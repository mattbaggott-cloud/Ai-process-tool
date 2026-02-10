"use client";

import React from "react";
import type { WorkflowNode } from "@/lib/types/database";

const TYPE_LABELS: Record<WorkflowNode["type"], { label: string; accent: string }> = {
  start:    { label: "Start",        accent: "#22c55e" },
  end:      { label: "End",          accent: "#ef4444" },
  process:  { label: "Process Step", accent: "#2563eb" },
  decision: { label: "Decision",     accent: "#f97316" },
  ai_agent: { label: "AI Agent",     accent: "#8b5cf6" },
  note:     { label: "Note",         accent: "#eab308" },
};

/* Type-specific property definitions */
const TYPE_FIELDS: Record<string, { key: string; label: string; multiline?: boolean }[]> = {
  process:  [{ key: "assignee", label: "Assignee" }, { key: "duration", label: "Duration" }],
  decision: [{ key: "condition", label: "Condition", multiline: true }],
  ai_agent: [{ key: "prompt", label: "Prompt", multiline: true }, { key: "model", label: "Model" }],
};

interface Props {
  node: WorkflowNode;
  onUpdate: (id: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onClose: () => void;
}

export default function WorkflowNodeEditor({ node, onUpdate, onDelete, onDuplicate, onClose }: Props) {
  const cfg = TYPE_LABELS[node.type];
  const fields = TYPE_FIELDS[node.type] ?? [];

  const setProp = (key: string, value: string) => {
    onUpdate(node.id, { properties: { ...node.properties, [key]: value } });
  };

  return (
    <div className="wf-editor-panel">
      {/* Header */}
      <div className="wf-editor-header">
        <span className="wf-editor-type-badge" style={{ backgroundColor: cfg.accent + "18", color: cfg.accent }}>
          {cfg.label}
        </span>
        <button className="wf-editor-close" onClick={onClose}>&times;</button>
      </div>

      {/* Title */}
      <div className="wf-editor-field">
        <label className="wf-editor-label">Title</label>
        <input className="wf-editor-input" value={node.title}
          onChange={(e) => onUpdate(node.id, { title: e.target.value })} />
      </div>

      {/* Description */}
      <div className="wf-editor-field">
        <label className="wf-editor-label">Description</label>
        <textarea className="wf-editor-input wf-editor-textarea" value={node.description} rows={3}
          onChange={(e) => onUpdate(node.id, { description: e.target.value })} />
      </div>

      {/* Type-specific fields */}
      {fields.length > 0 && (
        <>
          <div className="wf-editor-divider" />
          {fields.map((f) => (
            <div key={f.key} className="wf-editor-field">
              <label className="wf-editor-label">{f.label}</label>
              {f.multiline ? (
                <textarea className="wf-editor-input wf-editor-textarea" rows={3}
                  value={node.properties[f.key] ?? ""}
                  onChange={(e) => setProp(f.key, e.target.value)} />
              ) : (
                <input className="wf-editor-input"
                  value={node.properties[f.key] ?? ""}
                  onChange={(e) => setProp(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </>
      )}

      {/* Edge label (for decision nodes) */}
      {node.type === "decision" && (
        <>
          <div className="wf-editor-divider" />
          <p className="wf-editor-hint">
            Tip: Connect this decision&apos;s ports to different paths. Click an edge to add &quot;Yes&quot; / &quot;No&quot; labels.
          </p>
        </>
      )}

      {/* Actions */}
      <div className="wf-editor-actions">
        <button className="wf-editor-action-btn wf-editor-delete-btn" onClick={() => onDelete(node.id)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
          </svg>
          Delete
        </button>
        <button className="wf-editor-action-btn" onClick={() => onDuplicate(node.id)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <rect x="4" y="4" width="8" height="8" rx="1.5" /><path d="M4 10H3a1.5 1.5 0 01-1.5-1.5v-6A1.5 1.5 0 013 1h6A1.5 1.5 0 0110.5 2.5V4" />
          </svg>
          Duplicate
        </button>
      </div>
    </div>
  );
}
