"use client";

import React from "react";
import type { WorkflowNode, WorkflowEdge as WFEdge, WorkflowPort } from "@/lib/types/database";

/* ── Port position helper ──────────────────────────────── */

export function getPortPosition(node: WorkflowNode, port: WorkflowPort): { x: number; y: number } {
  if (node.type === "decision") {
    // Diamond: ports at the 4 vertices
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    switch (port.side) {
      case "top":    return { x: cx, y: node.y };
      case "bottom": return { x: cx, y: node.y + node.height };
      case "left":   return { x: node.x, y: cy };
      case "right":  return { x: node.x + node.width, y: cy };
    }
  }
  switch (port.side) {
    case "top":    return { x: node.x + node.width / 2, y: node.y };
    case "bottom": return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":   return { x: node.x, y: node.y + node.height / 2 };
    case "right":  return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/* ── Bezier path builder ───────────────────────────────── */

function buildPath(sp: { x: number; y: number }, sSide: string, tp: { x: number; y: number }, tSide: string): string {
  const dist = Math.max(60, Math.abs(sp.x - tp.x) / 2, Math.abs(sp.y - tp.y) / 2);
  const off = (side: string) => {
    switch (side) {
      case "top":    return { dx: 0, dy: -dist };
      case "bottom": return { dx: 0, dy: dist };
      case "left":   return { dx: -dist, dy: 0 };
      case "right":  return { dx: dist, dy: 0 };
      default:       return { dx: 0, dy: 0 };
    }
  };
  const so = off(sSide);
  const to = off(tSide);
  return `M ${sp.x} ${sp.y} C ${sp.x + so.dx} ${sp.y + so.dy}, ${tp.x + to.dx} ${tp.y + to.dy}, ${tp.x} ${tp.y}`;
}

/* ── Edge component ────────────────────────────────────── */

interface EdgeProps {
  edge: WFEdge;
  nodes: WorkflowNode[];
  onDelete: (id: string) => void;
}

export default function WorkflowEdgeComponent({ edge, nodes, onDelete }: EdgeProps) {
  const srcNode = nodes.find((n) => n.id === edge.sourceNodeId);
  const tgtNode = nodes.find((n) => n.id === edge.targetNodeId);
  if (!srcNode || !tgtNode) return null;

  const srcPort = srcNode.ports.find((p) => p.id === edge.sourcePortId);
  const tgtPort = tgtNode.ports.find((p) => p.id === edge.targetPortId);
  if (!srcPort || !tgtPort) return null;

  const sp = getPortPosition(srcNode, srcPort);
  const tp = getPortPosition(tgtNode, tgtPort);
  const d = buildPath(sp, srcPort.side, tp, tgtPort.side);

  // Midpoint for label + delete button
  const mx = (sp.x + tp.x) / 2;
  const my = (sp.y + tp.y) / 2;

  return (
    <g className="wf-edge-group">
      {/* Invisible wider path for easier hover */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: "pointer" }} />
      <path d={d} className="wf-edge-path" markerEnd="url(#wf-arrowhead)" />
      {edge.label && (
        <g transform={`translate(${mx}, ${my})`}>
          <rect x={-20} y={-10} width={40} height={20} rx={10} fill="#fff" stroke="#e5e7eb" strokeWidth={1} />
          <text className="wf-edge-label" textAnchor="middle" dy={4} fontSize={11}>{edge.label}</text>
        </g>
      )}
      <g className="wf-edge-delete" transform={`translate(${mx + 20}, ${my - 14})`}
        onClick={(e) => { e.stopPropagation(); onDelete(edge.id); }}
        style={{ cursor: "pointer" }}>
        <circle r={8} fill="#fff" stroke="#e5e7eb" strokeWidth={1} />
        <text textAnchor="middle" dy={4} fontSize={11} fill="#ef4444">&times;</text>
      </g>
    </g>
  );
}

/* ── Temp edge (while drawing a connection) ─────────────── */

export function TempEdge({ from, toWorld, fromSide }: { from: { x: number; y: number }; toWorld: { x: number; y: number }; fromSide: string }) {
  const d = buildPath(from, fromSide, toWorld, "top");
  return <path d={d} className="wf-edge-path wf-edge-temp" />;
}
