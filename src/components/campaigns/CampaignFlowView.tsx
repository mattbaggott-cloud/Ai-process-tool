"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { BuilderStep } from "@/lib/types/database";

/* ── Layout constants ─────────────────────────────────────── */
const NODE_W = 280;
const NODE_H = 80;
const NODE_GAP = 100; // vertical space between nodes
const CANVAS_PADDING = 60;

import { STEP_TYPE_META, CHANNEL_META } from "./campaign-constants";

/* ── Props ────────────────────────────────────────────────── */
interface CampaignFlowViewProps {
  steps: BuilderStep[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  groupName?: string;
  customerCount?: number;
}

export default function CampaignFlowView({
  steps,
  selectedIndex,
  onSelect,
  groupName,
  customerCount,
}: CampaignFlowViewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  /* ── Node positions ─────────────────────────────────────── */
  const positions = steps.map((_, i) => ({
    x: CANVAS_PADDING,
    y: CANVAS_PADDING + i * (NODE_H + NODE_GAP),
  }));

  /* ── Zoom ───────────────────────────────────────────────── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewport((v) => ({
      ...v,
      zoom: Math.max(0.25, Math.min(2, v.zoom * delta)),
    }));
  }, []);

  /* ── Pan ─────────────────────────────────────────────────── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".cf-node")) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y };
  }, [viewport.x, viewport.y]);

  useEffect(() => {
    if (!isPanning) return;
    const handleMove = (e: MouseEvent) => {
      setViewport((v) => ({
        ...v,
        x: panStart.current.vx + (e.clientX - panStart.current.x),
        y: panStart.current.vy + (e.clientY - panStart.current.y),
      }));
    };
    const handleUp = () => setIsPanning(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isPanning]);

  /* ── Fit to view ────────────────────────────────────────── */
  const fitToView = useCallback(() => {
    if (!canvasRef.current || steps.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const totalH = CANVAS_PADDING * 2 + steps.length * (NODE_H + NODE_GAP);
    const totalW = CANVAS_PADDING * 2 + NODE_W;
    const scaleX = rect.width / totalW;
    const scaleY = rect.height / totalH;
    const zoom = Math.min(scaleX, scaleY, 1.0);
    const x = (rect.width - totalW * zoom) / 2;
    const y = (rect.height - totalH * zoom) / 2;
    setViewport({ x, y, zoom });
  }, [steps.length]);

  useEffect(() => { fitToView(); }, [fitToView]);

  /* ── Cumulative days ────────────────────────────────────── */
  let cumDays = 0;
  const dayTotals = steps.map((s) => {
    cumDays += s.delay_days ?? 0;
    return cumDays;
  });

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="cf-canvas-wrap">
      <div
        ref={canvasRef}
        className={`wf-canvas ${isPanning ? "wf-panning" : ""}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {/* SVG edges */}
        <svg
          className="wf-edges-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <defs>
            <marker id="cf-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="none" stroke="#d1d5db" strokeWidth="1.5" />
            </marker>
          </defs>
          {positions.map((pos, i) => {
            if (i === 0) return null;
            const prev = positions[i - 1];
            const x = prev.x + NODE_W / 2;
            const y1 = prev.y + NODE_H;
            const y2 = pos.y;
            const midY = (y1 + y2) / 2;
            return (
              <g key={`edge-${i}`}>
                <path
                  d={`M${x},${y1} C${x},${midY} ${x},${midY} ${x},${y2}`}
                  className="wf-edge-path"
                  markerEnd="url(#cf-arrow)"
                />
                {steps[i].delay_days > 0 && (
                  <text
                    x={x + NODE_W / 2 - 30}
                    y={midY + 4}
                    className="cf-edge-label"
                    fill="#9ca3af"
                    fontSize="11"
                  >
                    {steps[i].delay_days}d
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Nodes layer */}
        <div
          className="wf-nodes-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Trigger node */}
          {groupName && (
            <div
              className="cf-node cf-node-trigger"
              style={{
                left: positions[0]?.x ?? CANVAS_PADDING,
                top: (positions[0]?.y ?? CANVAS_PADDING) - NODE_GAP,
                width: NODE_W,
              }}
            >
              <div className="cf-node-icon">\uD83C\uDFAF</div>
              <div className="cf-node-info">
                <div className="cf-node-title">Segment: {groupName}</div>
                {customerCount !== undefined && (
                  <div className="cf-node-meta">{customerCount} customers</div>
                )}
              </div>
            </div>
          )}

          {/* Step nodes */}
          {steps.map((step, i) => {
            const pos = positions[i];
            const meta = STEP_TYPE_META[step.step_type ?? "auto_email"] ?? STEP_TYPE_META.auto_email;
            const channelColor = step.channel ? CHANNEL_META[step.channel]?.color : undefined;

            return (
              <div
                key={step.id}
                className={`cf-node ${selectedIndex === i ? "cf-node-selected" : ""}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  minHeight: NODE_H,
                  borderLeftColor: channelColor,
                }}
                onClick={() => onSelect(i)}
              >
                <div className="cf-node-num">{i + 1}</div>
                <div className="cf-node-info">
                  <div className="cf-node-title">
                    {meta.icon} {step.subject_hint || meta.label}
                  </div>
                  <div className="cf-node-meta">
                    {meta.label} {step.channel ? `via ${step.channel}` : ""} \u00B7 Day {dayTotals[i]}
                  </div>
                </div>
              </div>
            );
          })}

          {/* End node */}
          {steps.length > 0 && (
            <div
              className="cf-node cf-node-end"
              style={{
                left: positions[positions.length - 1].x,
                top: positions[positions.length - 1].y + NODE_H + NODE_GAP,
                width: NODE_W,
              }}
            >
              <div className="cf-node-icon">\uD83C\uDFC1</div>
              <div className="cf-node-info">
                <div className="cf-node-title">End of Sequence</div>
                <div className="cf-node-meta">{dayTotals[dayTotals.length - 1]} days total</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="wf-toolbar">
        <button className="wf-toolbar-btn" onClick={fitToView} title="Fit to view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          Fit
        </button>
        <div className="wf-toolbar-sep" />
        <button className="wf-toolbar-btn" onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(2, v.zoom * 1.2) }))}>
          +
        </button>
        <span className="wf-toolbar-btn" style={{ cursor: "default" }}>
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button className="wf-toolbar-btn" onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(0.25, v.zoom * 0.8) }))}>
          \u2212
        </button>
      </div>
    </div>
  );
}
