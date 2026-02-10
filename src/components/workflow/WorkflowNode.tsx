"use client";

import React, { useRef, useCallback } from "react";
import type { WorkflowNode as WFNode, WorkflowPort } from "@/lib/types/database";

/* ── Type config ───────────────────────────────────────── */

const TYPE_CONFIG: Record<WFNode["type"], { label: string; badge: string; accent: string; icon: React.ReactNode }> = {
  start: {
    label: "Start", badge: "Start", accent: "#22c55e",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><polygon points="4,2 12,7 4,12" fill="currentColor" stroke="none" /></svg>,
  },
  end: {
    label: "End", badge: "End", accent: "#ef4444",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></svg>,
  },
  process: {
    label: "Process Step", badge: "Step", accent: "#2563eb",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5" /><path d="M7 4v3l2 1.5" /></svg>,
  },
  decision: {
    label: "Decision", badge: "Decision", accent: "#f97316",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1L13 7L7 13L1 7Z" /></svg>,
  },
  ai_agent: {
    label: "AI Agent", badge: "AI", accent: "#8b5cf6",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1l1.5 3.5L12 6l-3.5 1.5L7 11 5.5 7.5 2 6l3.5-1.5Z" /></svg>,
  },
  note: {
    label: "Note", badge: "Note", accent: "#eab308",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M5 5h4M5 7.5h3" /></svg>,
  },
};

/* ── Port position CSS ─────────────────────────────────── */

function portStyle(side: WorkflowPort["side"]): React.CSSProperties {
  switch (side) {
    case "top":    return { top: -5, left: "50%", marginLeft: -5 };
    case "bottom": return { bottom: -5, left: "50%", marginLeft: -5 };
    case "left":   return { left: -5, top: "50%", marginTop: -5 };
    case "right":  return { right: -5, top: "50%", marginTop: -5 };
  }
}

/* ── Component ─────────────────────────────────────────── */

interface Props {
  node: WFNode;
  selected: boolean;
  connecting: boolean;
  viewport: { x: number; y: number; zoom: number };
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPortClick: (nodeId: string, portId: string, side: string) => void;
  onTitleChange: (id: string, title: string) => void;
}

export default function WorkflowNodeComponent({ node, selected, connecting, viewport, onSelect, onMove, onPortClick, onTitleChange }: Props) {
  const cfg = TYPE_CONFIG[node.type];
  const isDragging = useRef(false);
  const titleRef = useRef<HTMLDivElement>(null);

  /* Drag to move */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("wf-port")) return; // let port handler take over
    e.stopPropagation();
    onSelect(node.id);

    isDragging.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = node.x;
    const origY = node.y;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = (ev.clientX - startX) / viewport.zoom;
      const dy = (ev.clientY - startY) / viewport.zoom;
      onMove(node.id, Math.round(origX + dx), Math.round(origY + dy));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [node.id, node.x, node.y, viewport.zoom, onSelect, onMove]);

  /* Inline title edit */
  const handleTitleBlur = useCallback(() => {
    if (!titleRef.current) return;
    const txt = titleRef.current.textContent?.trim() ?? "";
    if (txt !== node.title) onTitleChange(node.id, txt || node.title);
  }, [node.id, node.title, onTitleChange]);

  const isDecision = node.type === "decision";

  return (
    <div
      className={`wf-node wf-node-${node.type}${selected ? " wf-node-selected" : ""}`}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        height: node.type === "decision" ? node.height : undefined,
        minHeight: node.type !== "decision" ? node.height : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Accent bar */}
      {node.type !== "note" && node.type !== "decision" && (
        <div className="wf-node-accent" style={{ backgroundColor: cfg.accent }} />
      )}

      {/* Inner content */}
      <div className={isDecision ? "wf-node-diamond-inner" : "wf-node-inner"}>
        <div className="wf-node-header-row">
          <span className="wf-node-icon" style={{ color: cfg.accent }}>{cfg.icon}</span>
          <span className="wf-node-badge" style={{ backgroundColor: cfg.accent + "18", color: cfg.accent }}>{cfg.badge}</span>
        </div>
        <div
          ref={titleRef}
          className="wf-node-title"
          contentEditable
          suppressContentEditableWarning
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {node.title}
        </div>
        {node.description && !isDecision && (
          <div className="wf-node-desc">{node.description}</div>
        )}

        {/* Tool badge (process nodes with a tool assigned) */}
        {node.type === "process" && node.properties.tool_name && (
          <div className="wf-node-tool-badge">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="1" width="8" height="8" rx="2" />
            </svg>
            <span>{node.properties.tool_name}</span>
          </div>
        )}

        {/* Model badge (AI agent nodes) */}
        {node.type === "ai_agent" && node.properties.model && (
          <div className="wf-node-model-badge">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M5 1l1 2.5L8.5 4.5 6 5.5 5 8 4 5.5 1.5 4.5 4 3.5Z" />
            </svg>
            <span>{node.properties.model.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
          </div>
        )}

        {/* Duration + Cost metadata */}
        {(node.type === "process" || node.type === "ai_agent") &&
         (node.properties.duration || node.properties.cost) && (
          <div className="wf-node-meta">
            {node.properties.duration && <span>~{node.properties.duration}min</span>}
            {node.properties.duration && node.properties.cost && <span className="wf-node-meta-sep">|</span>}
            {node.properties.cost && <span>${node.properties.cost}</span>}
          </div>
        )}
      </div>

      {/* Ports */}
      {node.ports.map((port) => (
        <div
          key={port.id}
          className={`wf-port${connecting ? " wf-port-connectable" : ""}`}
          style={portStyle(port.side)}
          onMouseDown={(e) => {
            e.stopPropagation();
            onPortClick(node.id, port.id, port.side);
          }}
        />
      ))}
    </div>
  );
}
