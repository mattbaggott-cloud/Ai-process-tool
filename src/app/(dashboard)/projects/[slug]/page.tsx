"use client";

import { useParams } from "next/navigation";

const names: Record<string, string> = {
  "sdr-pipeline":      "SDR → AE Pipeline",
  outbound:            "Outbound Prospecting",
  "lead-qualification": "Lead Qualification",
};

export default function FlowBuilderPage() {
  const { slug } = useParams<{ slug: string }>();
  const title = names[slug] || slug;

  return (
    <>
      {/* Compact header */}
      <div className="canvas-header" style={{ padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a" }}>{title}</h1>
          <p style={{ fontSize: 13, color: "#6b7280" }}>Flow Builder</p>
        </div>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>Auto-saved</span>
      </div>

      {/* Whiteboard */}
      <div className="whiteboard">
        {/* Empty state centred */}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "#9ca3af", marginBottom: 8 }}>
              Drag and drop nodes to build your process flow
            </p>
            <p style={{ fontSize: 12, color: "#d1d5db" }}>
              Use the toolbar below to add steps, decisions, and AI agents
            </p>
          </div>
        </div>

        {/* Floating Toolbar */}
        <div className="floating-toolbar">
          <button className="toolbar-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 1l3 3-8.5 8.5H1.5V9.5L10 1z" /></svg>
            Edit
          </button>
          <div className="toolbar-divider" />
          <button className="toolbar-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="2" /><path d="M7 4v6M4 7h6" /></svg>
            Add Node
          </button>
          <button className="toolbar-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="1" fill="#fef3c7" stroke="#d1d5db" /><path d="M4 5h6M4 8h4" /></svg>
            Add Note
          </button>
          <div className="toolbar-divider" />
          <button className="toolbar-btn toolbar-btn-accent">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="3,1 13,7 3,13" /></svg>
            Simulate
          </button>
        </div>
      </div>
    </>
  );
}
