"use client";

import React, { useEffect, useRef } from "react";
import type { WorkflowNode } from "@/lib/types/database";

interface Props {
  node: WorkflowNode;
  x: number;
  y: number;
  onEdit: () => void;
  onAssignTool?: () => void;
  onAssignRole?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function WorkflowContextMenu({
  node, x, y, onEdit, onAssignTool, onAssignRole, onDuplicate, onDelete, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Edge-of-screen repositioning */
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    let ax = x;
    let ay = y;
    if (rect.right > window.innerWidth - pad) ax = window.innerWidth - rect.width - pad;
    if (rect.bottom > window.innerHeight - pad) ay = window.innerHeight - rect.height - pad;
    if (ax !== x || ay !== y) {
      ref.current.style.left = ax + "px";
      ref.current.style.top = ay + "px";
    }
  }, [x, y]);

  return (
    <div ref={ref} className="wf-context-menu" style={{ position: "fixed", left: x, top: y, zIndex: 10000 }}>
      <div className="wf-context-menu-header">{node.title || node.type}</div>

      <button className="wf-context-menu-item" onClick={onEdit}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M8.5 2.5l3 3M2 9l6.5-6.5 3 3L5 12H2V9z" />
        </svg>
        Edit
      </button>

      {onAssignTool && (
        <button className="wf-context-menu-item" onClick={onAssignTool}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="2" width="10" height="10" rx="2" />
          </svg>
          Assign Tool
        </button>
      )}

      {onAssignRole && (
        <button className="wf-context-menu-item" onClick={onAssignRole}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="5" r="2.5" />
            <path d="M2 13a5 5 0 0110 0" />
          </svg>
          Assign Role
        </button>
      )}

      <div className="wf-context-menu-sep" />

      <button className="wf-context-menu-item" onClick={onDuplicate}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
          <path d="M4 10H3a1.5 1.5 0 01-1.5-1.5v-6A1.5 1.5 0 013 1h6A1.5 1.5 0 0110.5 2.5V4" />
        </svg>
        Duplicate
      </button>

      <button className="wf-context-menu-item wf-context-menu-delete" onClick={onDelete}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
        </svg>
        Delete
      </button>
    </div>
  );
}
