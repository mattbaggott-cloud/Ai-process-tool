"use client";

import React, { useState, useRef, useEffect } from "react";
import type { WorkflowNodeType } from "@/lib/types/database";

const NODE_TYPES: { type: WorkflowNodeType; label: string; icon: React.ReactNode; accent: string }[] = [
  {
    type: "process", label: "Add Step", accent: "#2563eb",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5" /><path d="M7 4v3l2 1.5" /></svg>,
  },
  {
    type: "decision", label: "Decision", accent: "#f97316",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1L13 7L7 13L1 7Z" /></svg>,
  },
  {
    type: "ai_agent", label: "AI Agent", accent: "#8b5cf6",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1l1.5 3.5L12 6l-3.5 1.5L7 11 5.5 7.5 2 6l3.5-1.5Z" /></svg>,
  },
];

const MORE_NODE_TYPES: { type: WorkflowNodeType; label: string; icon: React.ReactNode; accent: string }[] = [
  {
    type: "start", label: "Start", accent: "#22c55e",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polygon points="4,2 12,7 4,12" fill="currentColor" /></svg>,
  },
  {
    type: "end", label: "End", accent: "#ef4444",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" /></svg>,
  },
  {
    type: "note", label: "Note", accent: "#eab308",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M5 5h4M5 7.5h3" /></svg>,
  },
];

interface Props {
  onAddNode: (type: WorkflowNodeType) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSimulate?: () => void;
  onHistory?: () => void;
  onGenerateFromDoc?: () => void;
  hasNodes?: boolean;
}

export default function WorkflowToolbar({ onAddNode, zoom, onZoomIn, onZoomOut, onFit, onSimulate, onHistory, onGenerateFromDoc, hasNodes }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="wf-toolbar">
      {/* Primary node buttons */}
      {NODE_TYPES.map((nt) => (
        <button key={nt.type} className="wf-toolbar-btn" onClick={() => onAddNode(nt.type)}>
          <span className="wf-toolbar-btn-icon" style={{ color: nt.accent }}>{nt.icon}</span>
          {nt.label}
        </button>
      ))}

      {/* More nodes dropdown */}
      <div ref={menuRef} style={{ position: "relative" }}>
        <button className="wf-toolbar-btn" onClick={() => setMenuOpen(!menuOpen)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="3" cy="7" r="1.3" /><circle cx="7" cy="7" r="1.3" /><circle cx="11" cy="7" r="1.3" />
          </svg>
          More
        </button>
        {menuOpen && (
          <div className="wf-toolbar-dropdown">
            {MORE_NODE_TYPES.map((nt) => (
              <button key={nt.type} className="wf-toolbar-dropdown-item" onClick={() => { onAddNode(nt.type); setMenuOpen(false); }}>
                <span className="wf-toolbar-dropdown-icon" style={{ color: nt.accent }}>{nt.icon}</span>
                {nt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wf-toolbar-sep" />

      {/* Icon action buttons — right side */}
      {onGenerateFromDoc && (
        <button className="wf-toolbar-icon-btn" onClick={onGenerateFromDoc}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0ea5e9" strokeWidth="1.4" strokeLinecap="round">
            <path d="M9.5 1.5H4.5A1.5 1.5 0 003 3v10a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 13V5l-3.5-3.5z" />
            <path d="M9.5 1.5V5H13" />
            <path d="M6 9h4M6 11.5h2.5" />
          </svg>
          <span className="wf-toolbar-icon-tooltip">Generate from Document</span>
        </button>
      )}

      {onSimulate && (
        <button
          className={`wf-toolbar-icon-btn${hasNodes ? "" : " wf-toolbar-icon-btn-disabled"}`}
          onClick={hasNodes ? onSimulate : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <polygon points="4,2 14,8 4,14" fill="#10b981" />
          </svg>
          <span className="wf-toolbar-icon-tooltip">{hasNodes ? "Simulate" : "Add nodes to simulate"}</span>
        </button>
      )}

      {onHistory && (
        <button className="wf-toolbar-icon-btn" onClick={onHistory}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6366f1" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.5v3.5l2.5 1.5" />
          </svg>
          <span className="wf-toolbar-icon-tooltip">Version History</span>
        </button>
      )}

      <div className="wf-toolbar-sep" />

      {/* Zoom controls */}
      <div className="wf-zoom-controls">
        <button className="wf-zoom-btn" onClick={onZoomOut} title="Zoom out">−</button>
        <span className="wf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="wf-zoom-btn" onClick={onZoomIn} title="Zoom in">+</button>
        <button className="wf-zoom-btn wf-zoom-fit" onClick={onFit} title="Fit to view">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M1 5V2a1 1 0 011-1h3M9 1h3a1 1 0 011 1v3M13 9v3a1 1 0 01-1 1h-3M5 13H2a1 1 0 01-1-1V9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
