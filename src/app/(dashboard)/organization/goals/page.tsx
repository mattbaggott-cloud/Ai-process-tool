"use client";

import React, { useState } from "react";
import GoalsTab from "@/components/goals/GoalsTab";
import PainPointsTab from "@/components/goals/PainPointsTab";

type TabKey = "goals" | "pain-points";

const tabs: { key: TabKey; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "pain-points", label: "Pain Points" },
];

export default function GoalsAndPainPointsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("goals");

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Goals &amp; Pain Points</h1>
          <p className="canvas-subtitle">
            Set objectives, track challenges, and link to teams &amp; KPIs
          </p>
        </div>
        <div className="section-tab-switcher">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`section-tab-pill ${activeTab === t.key ? "active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {activeTab === "goals" && <GoalsTab />}
        {activeTab === "pain-points" && <PainPointsTab />}
      </div>
    </>
  );
}
