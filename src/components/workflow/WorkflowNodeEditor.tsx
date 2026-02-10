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
interface FieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  type?: "text" | "select" | "number";
  options?: { value: string; label: string }[];
  step?: string;
}

const MODEL_OPTIONS = [
  { value: "", label: "Select model..." },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gemini-pro", label: "Gemini Pro" },
];

const TYPE_FIELDS: Record<string, FieldDef[]> = {
  process: [
    { key: "assignee", label: "Assignee" },
    { key: "duration", label: "Duration (min)", type: "number" },
    { key: "cost", label: "Cost ($)", type: "number", step: "0.01" },
  ],
  decision: [{ key: "condition", label: "Condition", multiline: true }],
  ai_agent: [
    { key: "prompt", label: "Instructions", multiline: true },
    { key: "model", label: "Model", type: "select", options: MODEL_OPTIONS },
    { key: "duration", label: "Duration (min)", type: "number" },
    { key: "cost", label: "Cost ($)", type: "number", step: "0.01" },
  ],
};

interface Props {
  node: WorkflowNode;
  stackTools: { id: string; name: string; category: string }[];
  onUpdate: (id: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onClose: () => void;
}

export default function WorkflowNodeEditor({ node, stackTools, onUpdate, onDelete, onDuplicate, onClose }: Props) {
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

      {/* Tool Assignment (process nodes only) */}
      {node.type === "process" && stackTools.length > 0 && (
        <>
          <div className="wf-editor-divider" />
          <div className="wf-editor-field">
            <label className="wf-editor-label">Assigned Tool</label>
            <select
              className="wf-editor-input wf-editor-select"
              value={node.properties.tool_id ?? ""}
              onChange={(e) => {
                const selected = stackTools.find(t => t.id === e.target.value);
                onUpdate(node.id, {
                  properties: {
                    ...node.properties,
                    tool_id: e.target.value,
                    tool_name: selected?.name ?? "",
                    tool_category: selected?.category ?? "",
                  },
                });
              }}
            >
              <option value="">No tool assigned</option>
              {stackTools.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ""}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Type-specific fields */}
      {fields.length > 0 && (
        <>
          <div className="wf-editor-divider" />
          {fields.map((f) => (
            <div key={f.key} className="wf-editor-field">
              <label className="wf-editor-label">{f.label}</label>
              {f.type === "select" ? (
                <select className="wf-editor-input wf-editor-select"
                  value={node.properties[f.key] ?? ""}
                  onChange={(e) => setProp(f.key, e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.multiline ? (
                <textarea className="wf-editor-input wf-editor-textarea" rows={3}
                  value={node.properties[f.key] ?? ""}
                  onChange={(e) => setProp(f.key, e.target.value)} />
              ) : (
                <input className="wf-editor-input"
                  type={f.type === "number" ? "number" : "text"}
                  min={f.type === "number" ? "0" : undefined}
                  step={f.step ?? (f.type === "number" ? "1" : undefined)}
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
