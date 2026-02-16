"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ConnectorsTab from "@/components/data/ConnectorsTab";
import ImportsTab from "@/components/data/ImportsTab";
import SyncLogTab from "@/components/data/SyncLogTab";

const TABS = [
  { key: "connectors", label: "Connectors" },
  { key: "imports", label: "Imports" },
  { key: "sync-log", label: "Sync Log" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function DataHomeInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(
    paramTab && TABS.some((t) => t.key === paramTab) ? paramTab : "connectors"
  );

  useEffect(() => {
    if (paramTab && TABS.some((t) => t.key === paramTab) && paramTab !== activeTab) {
      setActiveTab(paramTab);
    }
  }, [paramTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    router.replace(`/data?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="data-page">
      <div className="data-header">
        <h1 className="data-title">Data</h1>
        <p className="data-subtitle">Connect sources, import data, and manage your data pipeline</p>
      </div>

      <div className="data-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`data-tab ${activeTab === t.key ? "data-tab-active" : ""}`}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="data-content">
        {activeTab === "connectors" && <ConnectorsTab onNavigate={switchTab} />}
        {activeTab === "imports" && <ImportsTab />}
        {activeTab === "sync-log" && <SyncLogTab />}
      </div>
    </div>
  );
}

export default function DataHomePage() {
  return (
    <Suspense fallback={<div className="data-loading">Loading Data...</div>}>
      <DataHomeInner />
    </Suspense>
  );
}
