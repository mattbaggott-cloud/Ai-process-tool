"use client";

import { useParams } from "next/navigation";

const teamData: Record<string, string> = {
  sales:              "Sales",
  marketing:          "Marketing",
  "customer-success": "Customer Success",
};

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const teamName = teamData[slug] || slug;

  return (
    <>
      {/* Header */}
      <div className="canvas-header">
        <h1 className="canvas-title">{teamName}</h1>
        <p className="canvas-subtitle">
          Define roles, KPIs, and tools for this team
        </p>
      </div>

      {/* Content */}
      <div className="canvas-content">
        {/* Stats */}
        <div className="stat-grid stat-grid-3" style={{ marginBottom: 32 }}>
          {[
            { label: "Headcount", value: "—" },
            { label: "Roles",     value: "—" },
            { label: "KPIs",      value: "—" },
          ].map((s) => (
            <div key={s.label} className="stat-box">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Roles Card */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">Roles &amp; Functions</h3>
            <button className="text-link">+ Add Role</button>
          </div>
          <p style={{ fontSize: 13, color: "#6b7280" }}>
            No roles defined yet. Add roles to describe who works on this team.
          </p>
        </div>

        {/* KPIs Card */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">KPIs</h3>
            <button className="text-link">+ Add KPI</button>
          </div>
          <p style={{ fontSize: 13, color: "#6b7280" }}>
            No KPIs defined yet. Add the metrics this team tracks.
          </p>
        </div>

        {/* Tools Card */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">Tools Used</h3>
            <button className="text-link">+ Add Tool</button>
          </div>
          <p style={{ fontSize: 13, color: "#6b7280" }}>
            No tools listed yet. Add the tools this team uses daily.
          </p>
        </div>

        {/* How This Team Works */}
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">How This Team Works</h3>
          </div>
          <textarea
            className="input textarea"
            rows={4}
            placeholder="Describe how this team operates, their daily workflow, key processes..."
          />
        </div>
      </div>
    </>
  );
}
