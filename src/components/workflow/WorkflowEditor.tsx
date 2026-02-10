"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { WorkflowData, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowPort } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import WorkflowNodeComponent from "./WorkflowNode";
import WorkflowEdgeComponent, { TempEdge, getPortPosition } from "./WorkflowEdge";
import WorkflowToolbar from "./WorkflowToolbar";
import WorkflowNodeEditor from "./WorkflowNodeEditor";
import WorkflowSimulationModal from "./WorkflowSimulationModal";

/* ── Helpers ───────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function screenToWorld(sx: number, sy: number, vp: { x: number; y: number; zoom: number }) {
  return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
}

/* ── Default node configs ──────────────────────────────── */

const DEFAULT_PORTS: Record<WorkflowNodeType, WorkflowPort["side"][]> = {
  start:    ["bottom"],
  end:      ["top"],
  process:  ["top", "bottom", "left", "right"],
  decision: ["top", "bottom", "left", "right"],
  ai_agent: ["top", "bottom", "left", "right"],
  note:     [],
};

const DEFAULT_SIZES: Record<WorkflowNodeType, { w: number; h: number }> = {
  start:    { w: 140, h: 48 },
  end:      { w: 140, h: 48 },
  process:  { w: 220, h: 96 },
  decision: { w: 140, h: 140 },
  ai_agent: { w: 220, h: 96 },
  note:     { w: 180, h: 100 },
};

const DEFAULT_TITLES: Record<WorkflowNodeType, string> = {
  start: "Start", end: "End", process: "New Step", decision: "Decision", ai_agent: "AI Agent", note: "Note",
};

function createNode(type: WorkflowNodeType, x: number, y: number): WorkflowNode {
  const size = DEFAULT_SIZES[type];
  return {
    id: uid(),
    type,
    x, y,
    width: size.w,
    height: size.h,
    title: DEFAULT_TITLES[type],
    description: "",
    properties: {},
    ports: DEFAULT_PORTS[type].map((side) => ({ id: uid(), side })),
  };
}

/* ══════════════════════════════════════════════════════════
   WORKFLOW EDITOR
   ══════════════════════════════════════════════════════════ */

interface Props {
  data: WorkflowData;
  onChange: (data: WorkflowData) => void;
}

export default function WorkflowEditor({ data, onChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewportState] = useState(data.viewport);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ nodeId: string; portId: string; side: string } | null>(null);
  const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number } | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);
  const isPanning = useRef(false);
  const vpRef = useRef(viewport);
  const vpSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep vpRef in sync
  useEffect(() => { vpRef.current = viewport; }, [viewport]);

  /* ── Fetch user's stack tools for tool assignment ── */
  const { user } = useAuth();
  const [stackTools, setStackTools] = useState<{ id: string; name: string; category: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("user_stack_tools")
      .select("id, name, category")
      .order("name")
      .then(({ data: tools }) => {
        setStackTools((tools ?? []).map(t => ({
          id: t.id,
          name: t.name,
          category: t.category ?? "",
        })));
      });
  }, [user]);

  /* ── Viewport helpers ── */
  const setViewport = useCallback((vp: typeof viewport) => {
    setViewportState(vp);
    // Debounce viewport saves (2s)
    if (vpSaveTimer.current) clearTimeout(vpSaveTimer.current);
    vpSaveTimer.current = setTimeout(() => {
      onChange({ ...data, viewport: vp });
    }, 2000);
  }, [data, onChange]);

  /* ── Data mutators ── */
  const updateData = useCallback((patch: Partial<WorkflowData>) => {
    onChange({ ...data, ...patch, viewport: vpRef.current });
  }, [data, onChange]);

  const addNode = useCallback((type: WorkflowNodeType) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const center = screenToWorld(rect.width / 2, rect.height / 2, vpRef.current);
    const size = DEFAULT_SIZES[type];
    const node = createNode(type, Math.round(center.x - size.w / 2), Math.round(center.y - size.h / 2));
    updateData({ nodes: [...data.nodes, node] });
  }, [data.nodes, updateData]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    updateData({ nodes: data.nodes.map((n) => n.id === id ? { ...n, x, y } : n) });
  }, [data.nodes, updateData]);

  const updateNode = useCallback((id: string, patch: Partial<WorkflowNode>) => {
    updateData({ nodes: data.nodes.map((n) => n.id === id ? { ...n, ...patch } : n) });
  }, [data.nodes, updateData]);

  const deleteNode = useCallback((id: string) => {
    setSelectedId(null);
    updateData({
      nodes: data.nodes.filter((n) => n.id !== id),
      edges: data.edges.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id),
    });
  }, [data.nodes, data.edges, updateData]);

  const duplicateNode = useCallback((id: string) => {
    const src = data.nodes.find((n) => n.id === id);
    if (!src) return;
    const dup = createNode(src.type, src.x + 30, src.y + 30);
    dup.title = src.title + " (copy)";
    dup.description = src.description;
    dup.properties = { ...src.properties };
    updateData({ nodes: [...data.nodes, dup] });
    setSelectedId(dup.id);
  }, [data.nodes, updateData]);

  const deleteEdge = useCallback((id: string) => {
    updateData({ edges: data.edges.filter((e) => e.id !== id) });
  }, [data.edges, updateData]);

  const addEdge = useCallback((srcNodeId: string, srcPortId: string, tgtNodeId: string, tgtPortId: string) => {
    if (srcNodeId === tgtNodeId) return;
    // Prevent duplicate edges
    if (data.edges.some((e) => e.sourceNodeId === srcNodeId && e.sourcePortId === srcPortId && e.targetNodeId === tgtNodeId && e.targetPortId === tgtPortId)) return;
    const edge: WorkflowEdge = { id: uid(), sourceNodeId: srcNodeId, sourcePortId: srcPortId, targetNodeId: tgtNodeId, targetPortId: tgtPortId };
    updateData({ edges: [...data.edges, edge] });
  }, [data.edges, updateData]);

  /* ── Port click → connection ── */
  const handlePortClick = useCallback((nodeId: string, portId: string, side: string) => {
    if (!connecting) {
      setConnecting({ nodeId, portId, side });
    } else {
      if (connecting.nodeId !== nodeId) {
        addEdge(connecting.nodeId, connecting.portId, nodeId, portId);
      }
      setConnecting(null);
      setMouseWorld(null);
    }
  }, [connecting, addEdge]);

  /* ── Pan ── */
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan if clicking empty space
    if (e.target !== canvasRef.current && !(e.target as HTMLElement).classList.contains("wf-edges-layer")) return;
    if (connecting) {
      setConnecting(null);
      setMouseWorld(null);
      return;
    }
    setSelectedId(null);
    isPanning.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startVp = { ...vpRef.current };

    const onMove = (ev: MouseEvent) => {
      if (!isPanning.current) return;
      setViewport({
        x: startVp.x + (ev.clientX - startX),
        y: startVp.y + (ev.clientY - startY),
        zoom: startVp.zoom,
      });
    };
    const onUp = () => {
      isPanning.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [connecting, setViewport]);

  /* ── Zoom ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const vp = vpRef.current;
    const scaleBy = e.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = clamp(vp.zoom * scaleBy, 0.25, 2.0);
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setViewport({
      x: mx - (mx - vp.x) * (newZoom / vp.zoom),
      y: my - (my - vp.y) * (newZoom / vp.zoom),
      zoom: newZoom,
    });
  }, [setViewport]);

  const zoomIn = useCallback(() => {
    const vp = vpRef.current;
    const newZoom = clamp(vp.zoom * 1.2, 0.25, 2.0);
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport({ x: cx - (cx - vp.x) * (newZoom / vp.zoom), y: cy - (cy - vp.y) * (newZoom / vp.zoom), zoom: newZoom });
  }, [setViewport]);

  const zoomOut = useCallback(() => {
    const vp = vpRef.current;
    const newZoom = clamp(vp.zoom * 0.8, 0.25, 2.0);
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport({ x: cx - (cx - vp.x) * (newZoom / vp.zoom), y: cy - (cy - vp.y) * (newZoom / vp.zoom), zoom: newZoom });
  }, [setViewport]);

  const fitToView = useCallback(() => {
    if (data.nodes.length === 0) { setViewport({ x: 0, y: 0, zoom: 1 }); return; }
    const rect = canvasRef.current!.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const pad = 80;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const zoom = clamp(Math.min(rect.width / bw, rect.height / bh), 0.25, 1.5);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setViewport({ x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom, zoom });
  }, [data.nodes, setViewport]);

  /* ── Mouse move for temp edge ── */
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!connecting || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, vpRef.current);
    setMouseWorld(world);
  }, [connecting]);

  /* ── Escape cancels connecting ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConnecting(null); setMouseWorld(null); setSelectedId(null); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && !(document.activeElement?.getAttribute("contenteditable") === "true") && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          deleteNode(selectedId);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedId, deleteNode]);

  /* ── Temp edge source position ── */
  let tempEdgeFrom: { x: number; y: number } | null = null;
  if (connecting) {
    const srcNode = data.nodes.find((n) => n.id === connecting.nodeId);
    const srcPort = srcNode?.ports.find((p) => p.id === connecting.portId);
    if (srcNode && srcPort) tempEdgeFrom = getPortPosition(srcNode, srcPort);
  }

  const selectedNode = data.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <>
      <div
        ref={canvasRef}
        className={`wf-canvas${isPanning.current ? " wf-panning" : ""}${connecting ? " wf-connecting" : ""}`}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onWheel={handleWheel}
      >
        {/* Empty state */}
        {data.nodes.length === 0 && (
          <div className="wf-empty">
            <div className="wf-empty-inner">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                <rect x="4" y="4" width="16" height="12" rx="3" />
                <rect x="28" y="4" width="16" height="12" rx="3" />
                <rect x="16" y="32" width="16" height="12" rx="3" />
                <path d="M12 16v6l12 10M36 16v6L24 32" strokeDasharray="3 2" />
              </svg>
              <p className="wf-empty-text">Build your workflow</p>
              <p className="wf-empty-sub">Add nodes from the toolbar below to map out your process</p>
            </div>
          </div>
        )}

        {/* SVG edge layer */}
        <svg className="wf-edges-layer" onMouseDown={handleCanvasMouseDown}>
          <defs>
            <marker id="wf-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#d1d5db" />
            </marker>
          </defs>
          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {data.edges.map((edge) => (
              <WorkflowEdgeComponent key={edge.id} edge={edge} nodes={data.nodes} onDelete={deleteEdge} />
            ))}
            {tempEdgeFrom && mouseWorld && (
              <TempEdge from={tempEdgeFrom} toWorld={mouseWorld} fromSide={connecting!.side} />
            )}
          </g>
        </svg>

        {/* Node layer */}
        <div className="wf-nodes-layer" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: "0 0" }}>
          {data.nodes.map((node) => (
            <WorkflowNodeComponent
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              connecting={!!connecting}
              viewport={viewport}
              onSelect={setSelectedId}
              onMove={moveNode}
              onPortClick={handlePortClick}
              onTitleChange={(id, title) => updateNode(id, { title })}
            />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <WorkflowToolbar
        onAddNode={addNode}
        zoom={viewport.zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fitToView}
        onSimulate={() => setShowSimulation(true)}
        hasNodes={data.nodes.length > 0}
      />

      {/* Node editor panel */}
      {selectedNode && (
        <WorkflowNodeEditor
          node={selectedNode}
          stackTools={stackTools}
          onUpdate={updateNode}
          onDelete={deleteNode}
          onDuplicate={duplicateNode}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Simulation modal */}
      {showSimulation && (
        <WorkflowSimulationModal
          data={data}
          onClose={() => setShowSimulation(false)}
        />
      )}
    </>
  );
}
