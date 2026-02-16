"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ContactsTab from "@/components/crm/ContactsTab";
import CompaniesTab from "@/components/crm/CompaniesTab";
import DealsTab from "@/components/crm/DealsTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
const TABS = [
  { key: "contacts", label: "Contacts" },
  { key: "companies", label: "Companies" },
  { key: "deals", label: "Deals" },
  { key: "activities", label: "Activities" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function CrmPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(paramTab && TABS.some(t => t.key === paramTab) ? paramTab : "contacts");

  useEffect(() => {
    if (paramTab && TABS.some(t => t.key === paramTab) && paramTab !== activeTab) {
      setActiveTab(paramTab);
    }
  }, [paramTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    router.replace(`/crm?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="crm-page">
      <div className="crm-header">
        <h1 className="crm-title">CRM</h1>
      </div>

      <div className="crm-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`crm-tab ${activeTab === t.key ? "crm-tab-active" : ""}`}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="crm-content">
        {activeTab === "contacts" && <ContactsTab />}
        {activeTab === "companies" && <CompaniesTab />}
        {activeTab === "deals" && <DealsTab />}
        {activeTab === "activities" && <ActivitiesTab />}
      </div>
    </div>
  );
}

export default function CrmPage() {
  return (
    <Suspense fallback={<div className="crm-loading">Loading CRM...</div>}>
      <CrmPageInner />
    </Suspense>
  );
}
