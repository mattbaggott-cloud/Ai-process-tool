"use client";

import React, { useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import type { WorkflowData, WorkflowNode } from "@/lib/types/database";

/* ── Analysis types ───────────────────────────────────── */

interface PathInfo {
  nodes: WorkflowNode[];
  totalDuration: number;
  totalCost: number;
  label: string;
}

interface RoleBreakdown {
  role: string;
  team: string;
  nodeCount: number;
  totalDuration: number;
  totalCost: number;
}

interface Handoff {
  from: WorkflowNode;
  to: WorkflowNode;
  fromRole: string;
  toRole: string;
}

interface SimulationResult {
  totalNodes: number;
  totalEdges: number;
  processSteps: number;
  decisionPoints: number;
  aiAgentSteps: number;
  totalDuration: number;
  totalCost: number;
  longestPath: PathInfo | null;
  shortestPath: PathInfo | null;
  bottlenecks: WorkflowNode[];
  unconnected: WorkflowNode[];
  missingStart: boolean;
  missingEnd: boolean;
  suggestions: string[];
  roleBreakdown: RoleBreakdown[];
  handoffs: Handoff[];
}

/* ── Graph analysis ───────────────────────────────────── */

function analyzeWorkflow(data: WorkflowData): SimulationResult {
  const { nodes, edges } = data;

  const processNodes = nodes.filter((n) => n.type === "process");
  const decisionNodes = nodes.filter((n) => n.type === "decision");
  const aiNodes = nodes.filter((n) => n.type === "ai_agent");
  const startNodes = nodes.filter((n) => n.type === "start");
  const endNodes = nodes.filter((n) => n.type === "end");
  const noteNodes = nodes.filter((n) => n.type === "note");

  const missingStart = startNodes.length === 0;
  const missingEnd = endNodes.length === 0;

  /* Build adjacency list */
  const adj = new Map<string, { nodeId: string; edgeLabel?: string }[]>();
  for (const e of edges) {
    if (!adj.has(e.sourceNodeId)) adj.set(e.sourceNodeId, []);
    adj.get(e.sourceNodeId)!.push({ nodeId: e.targetNodeId, edgeLabel: e.label });
  }

  /* Find connected node IDs (excluding notes) */
  const connectedIds = new Set<string>();
  for (const e of edges) {
    connectedIds.add(e.sourceNodeId);
    connectedIds.add(e.targetNodeId);
  }
  const unconnected = nodes.filter(
    (n) => n.type !== "note" && !connectedIds.has(n.id) && nodes.length > 1
  );

  /* Aggregate duration & cost from all process + AI nodes */
  let totalDuration = 0;
  let totalCost = 0;
  for (const n of [...processNodes, ...aiNodes]) {
    const d = parseFloat(n.properties.duration || "0");
    const c = parseFloat(n.properties.cost || "0");
    if (!isNaN(d)) totalDuration += d;
    if (!isNaN(c)) totalCost += c;
  }

  /* Find all paths from start → end using DFS */
  const allPaths: PathInfo[] = [];

  function dfs(current: string, visited: Set<string>, path: WorkflowNode[], label: string) {
    const node = nodes.find((n) => n.id === current);
    if (!node) return;
    if (visited.has(current)) return;

    visited.add(current);
    path.push(node);

    if (node.type === "end") {
      let pathDuration = 0;
      let pathCost = 0;
      for (const p of path) {
        const d = parseFloat(p.properties.duration || "0");
        const c = parseFloat(p.properties.cost || "0");
        if (!isNaN(d)) pathDuration += d;
        if (!isNaN(c)) pathCost += c;
      }
      allPaths.push({ nodes: [...path], totalDuration: pathDuration, totalCost: pathCost, label });
    } else {
      const neighbors = adj.get(current) ?? [];
      for (const { nodeId, edgeLabel } of neighbors) {
        const branchLabel = edgeLabel ? `${label}${label ? " → " : ""}${edgeLabel}` : label;
        dfs(nodeId, new Set(visited), [...path], branchLabel);
      }
    }

    visited.delete(current);
  }

  for (const s of startNodes) {
    dfs(s.id, new Set(), [], "");
  }

  /* Sort paths by duration */
  allPaths.sort((a, b) => b.totalDuration - a.totalDuration);
  const longestPath = allPaths[0] ?? null;
  const shortestPath = allPaths.length > 1 ? allPaths[allPaths.length - 1] : null;

  /* Find bottlenecks: nodes with highest duration */
  const timedNodes = [...processNodes, ...aiNodes]
    .filter((n) => parseFloat(n.properties.duration || "0") > 0)
    .sort((a, b) => parseFloat(b.properties.duration || "0") - parseFloat(a.properties.duration || "0"));
  const bottlenecks = timedNodes.slice(0, 3);

  /* Generate suggestions */
  const suggestions: string[] = [];

  if (missingStart) suggestions.push("Add a Start node to define the entry point of your flow.");
  if (missingEnd) suggestions.push("Add an End node to define where the flow terminates.");
  if (unconnected.length > 0) {
    suggestions.push(`${unconnected.length} node(s) are not connected to any edges — they won't be part of the flow.`);
  }
  if (bottlenecks.length > 0) {
    const top = bottlenecks[0];
    const dur = parseFloat(top.properties.duration || "0");
    suggestions.push(`"${top.title}" is your biggest bottleneck at ~${dur}min. Consider parallelizing or automating this step.`);
  }
  if (aiNodes.length === 0 && processNodes.length > 2) {
    suggestions.push("Consider adding AI Agent nodes to automate repetitive manual steps.");
  }
  if (decisionNodes.length === 0 && processNodes.length > 3) {
    suggestions.push("Your flow is linear — consider adding Decision nodes for error handling or conditional paths.");
  }
  if (allPaths.length > 1 && longestPath && shortestPath) {
    const diff = longestPath.totalDuration - shortestPath.totalDuration;
    if (diff > 5) {
      suggestions.push(`Path variance is ${diff}min between longest and shortest. Optimize the critical path to reduce average flow time.`);
    }
  }
  if (totalCost > 0 && aiNodes.length > 0) {
    const avgAiCost = totalCost / aiNodes.length;
    if (avgAiCost > 1) {
      suggestions.push(`Average AI step cost is $${avgAiCost.toFixed(2)}. Consider using lighter models (e.g. GPT-4o Mini) for simpler tasks.`);
    }
  }
  if (noteNodes.length === 0 && nodes.length > 4) {
    suggestions.push("Add Note nodes to document assumptions, edge cases, or team responsibilities.");
  }
  if (suggestions.length === 0) {
    suggestions.push("Your flow looks well-structured! Add duration estimates to all steps for more accurate simulation.");
  }

  /* ── Role breakdown ── */
  const roleMap = new Map<string, RoleBreakdown>();
  for (const n of [...processNodes, ...aiNodes]) {
    const roleName = n.properties.role_name;
    if (!roleName) continue;
    const key = `${roleName}|${n.properties.role_team || ""}`;
    if (!roleMap.has(key)) {
      roleMap.set(key, { role: roleName, team: n.properties.role_team || "", nodeCount: 0, totalDuration: 0, totalCost: 0 });
    }
    const entry = roleMap.get(key)!;
    entry.nodeCount++;
    entry.totalDuration += parseFloat(n.properties.duration || "0") || 0;
    entry.totalCost += parseFloat(n.properties.cost || "0") || 0;
  }
  const roleBreakdown = Array.from(roleMap.values()).sort((a, b) => b.totalDuration - a.totalDuration);

  /* ── Handoff detection (role changes along edges) ── */
  const handoffs: Handoff[] = [];
  for (const e of edges) {
    const src = nodes.find((n) => n.id === e.sourceNodeId);
    const tgt = nodes.find((n) => n.id === e.targetNodeId);
    if (!src || !tgt) continue;
    const srcRole = src.properties.role_name;
    const tgtRole = tgt.properties.role_name;
    if (srcRole && tgtRole && srcRole !== tgtRole) {
      handoffs.push({ from: src, to: tgt, fromRole: srcRole, toRole: tgtRole });
    }
  }

  /* Role-based suggestions */
  if (handoffs.length > 3) {
    suggestions.push(`${handoffs.length} handoffs between different roles — consider reducing cross-team dependencies to speed up the flow.`);
  }
  if (roleBreakdown.length > 0) {
    const topRole = roleBreakdown[0];
    if (topRole.totalDuration > totalDuration * 0.5 && topRole.totalDuration > 5) {
      suggestions.push(`"${topRole.role}" owns ${topRole.totalDuration}min of work (${Math.round(topRole.totalDuration / totalDuration * 100)}% of total). Consider distributing load across roles.`);
    }
  }

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    processSteps: processNodes.length,
    decisionPoints: decisionNodes.length,
    aiAgentSteps: aiNodes.length,
    totalDuration,
    totalCost,
    longestPath,
    shortestPath,
    bottlenecks,
    unconnected,
    missingStart,
    missingEnd,
    suggestions,
    roleBreakdown,
    handoffs,
  };
}

/* ── Bottleneck bar helper ────────────────────────────── */

function BottleneckBar({ node, maxDuration }: { node: WorkflowNode; maxDuration: number }) {
  const dur = parseFloat(node.properties.duration || "0");
  const pct = maxDuration > 0 ? (dur / maxDuration) * 100 : 0;
  return (
    <div className="wf-sim-bn-row">
      <span className="wf-sim-bn-name">{node.title}</span>
      <div className="wf-sim-bn-bar-track">
        <div className="wf-sim-bn-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="wf-sim-bn-dur">~{dur}m</span>
      {node.properties.cost && <span className="wf-sim-bn-cost">${node.properties.cost}</span>}
    </div>
  );
}

/* ── Component ────────────────────────────────────────── */

interface Props {
  data: WorkflowData;
  onClose: () => void;
}

export default function WorkflowSimulationModal({ data, onClose }: Props) {
  const result = useMemo(() => analyzeWorkflow(data), [data]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const maxBnDuration = result.bottlenecks.length > 0
    ? parseFloat(result.bottlenecks[0].properties.duration || "0")
    : 0;

  const modal = (
    <div className="wf-sim-overlay" onClick={onClose}>
      <div className="wf-sim-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wf-sim-header">
          <div className="wf-sim-header-left">
            <div className="wf-sim-header-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <polygon points="4,2 15,9 4,16" fill="#10b981" />
              </svg>
            </div>
            <div>
              <h2 className="wf-sim-title">Flow Simulation Report</h2>
              <p className="wf-sim-subtitle">{result.totalNodes} nodes &middot; {result.totalEdges} connections</p>
            </div>
          </div>
          <button className="wf-sim-close" onClick={onClose} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Summary cards */}
        <div className="wf-sim-cards">
          <div className="wf-sim-card">
            <span className="wf-sim-card-value">{result.processSteps}</span>
            <span className="wf-sim-card-label">Steps</span>
          </div>
          <div className="wf-sim-card">
            <span className="wf-sim-card-value">{result.decisionPoints}</span>
            <span className="wf-sim-card-label">Decisions</span>
          </div>
          <div className="wf-sim-card">
            <span className="wf-sim-card-value">{result.aiAgentSteps}</span>
            <span className="wf-sim-card-label">AI Agents</span>
          </div>
          <div className="wf-sim-card wf-sim-card-time">
            <span className="wf-sim-card-value">{result.totalDuration > 0 ? `${result.totalDuration}m` : "—"}</span>
            <span className="wf-sim-card-label">Est. Time</span>
          </div>
          <div className="wf-sim-card wf-sim-card-cost">
            <span className="wf-sim-card-value">{result.totalCost > 0 ? `$${result.totalCost.toFixed(2)}` : "—"}</span>
            <span className="wf-sim-card-label">Est. Cost</span>
          </div>
        </div>

        <div className="wf-sim-body">
          {/* Critical path */}
          {result.longestPath && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title">
                {result.shortestPath ? "Critical Path (Longest)" : "Flow Path"}
              </h3>
              <div className="wf-sim-path">
                {result.longestPath.nodes.map((n, i) => (
                  <React.Fragment key={n.id}>
                    {i > 0 && <span className="wf-sim-path-arrow">&rarr;</span>}
                    <span className={`wf-sim-path-node wf-sim-pn-${n.type}`}>
                      {n.title}
                      {n.properties.duration && (
                        <span className="wf-sim-path-dur">{n.properties.duration}m</span>
                      )}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <div className="wf-sim-path-summary">
                ~{result.longestPath.totalDuration}min
                {result.longestPath.totalCost > 0 && ` · $${result.longestPath.totalCost.toFixed(2)}`}
                {result.longestPath.label && ` · via ${result.longestPath.label}`}
              </div>
            </div>
          )}

          {/* Fastest path */}
          {result.shortestPath && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title">Fastest Path</h3>
              <div className="wf-sim-path">
                {result.shortestPath.nodes.map((n, i) => (
                  <React.Fragment key={n.id}>
                    {i > 0 && <span className="wf-sim-path-arrow">&rarr;</span>}
                    <span className={`wf-sim-path-node wf-sim-pn-${n.type}`}>
                      {n.title}
                      {n.properties.duration && (
                        <span className="wf-sim-path-dur">{n.properties.duration}m</span>
                      )}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <div className="wf-sim-path-summary">
                ~{result.shortestPath.totalDuration}min
                {result.shortestPath.totalCost > 0 && ` · $${result.shortestPath.totalCost.toFixed(2)}`}
                {result.shortestPath.label && ` · via ${result.shortestPath.label}`}
              </div>
            </div>
          )}

          {/* Bottlenecks with visual bars */}
          {result.bottlenecks.length > 0 && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title wf-sim-st-orange">Bottlenecks</h3>
              <div className="wf-sim-bn-list">
                {result.bottlenecks.map((n) => (
                  <BottleneckBar key={n.id} node={n} maxDuration={maxBnDuration} />
                ))}
              </div>
            </div>
          )}

          {/* Role breakdown */}
          {result.roleBreakdown.length > 0 && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title wf-sim-st-teal">Team / Role Breakdown</h3>
              <div className="wf-sim-role-list">
                {result.roleBreakdown.map((r) => (
                  <div key={`${r.role}-${r.team}`} className="wf-sim-role-row">
                    <div className="wf-sim-role-info">
                      <span className="wf-sim-role-name">{r.role}</span>
                      {r.team && <span className="wf-sim-role-team">{r.team}</span>}
                    </div>
                    <div className="wf-sim-role-stats">
                      <span>{r.nodeCount} step{r.nodeCount !== 1 ? "s" : ""}</span>
                      {r.totalDuration > 0 && <span>~{r.totalDuration}m</span>}
                      {r.totalCost > 0 && <span>${r.totalCost.toFixed(2)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Handoffs */}
          {result.handoffs.length > 0 && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title wf-sim-st-amber">
                Handoffs ({result.handoffs.length})
              </h3>
              <div className="wf-sim-handoff-list">
                {result.handoffs.map((h, i) => (
                  <div key={i} className="wf-sim-handoff-row">
                    <span className="wf-sim-handoff-role">{h.fromRole}</span>
                    <span className="wf-sim-handoff-arrow">&rarr;</span>
                    <span className="wf-sim-handoff-role">{h.toRole}</span>
                    <span className="wf-sim-handoff-context">
                      {h.from.title} &rarr; {h.to.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {(result.unconnected.length > 0 || result.missingStart || result.missingEnd) && (
            <div className="wf-sim-section">
              <h3 className="wf-sim-section-title wf-sim-st-red">Warnings</h3>
              <div className="wf-sim-warnings">
                {result.missingStart && (
                  <div className="wf-sim-warn-item">No Start node — flow has no defined entry point.</div>
                )}
                {result.missingEnd && (
                  <div className="wf-sim-warn-item">No End node — flow has no defined terminal state.</div>
                )}
                {result.unconnected.length > 0 && (
                  <div className="wf-sim-warn-item">
                    {result.unconnected.length} unconnected node(s):&nbsp;
                    {result.unconnected.map((n) => n.title).join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Suggestions */}
          <div className="wf-sim-section">
            <h3 className="wf-sim-section-title wf-sim-st-purple">Suggestions</h3>
            <div className="wf-sim-suggestions">
              {result.suggestions.map((s, i) => (
                <div key={i} className="wf-sim-sug-item">{s}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* Portal to document.body so it escapes .whiteboard overflow:hidden */
  return createPortal(modal, document.body);
}
