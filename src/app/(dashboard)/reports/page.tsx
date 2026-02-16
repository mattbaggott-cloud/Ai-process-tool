"use client";

import React from "react";
import ReportsTab from "@/components/crm/ReportsTab";

export default function ReportsPage() {
  return (
    <div className="crm-page">
      <div className="crm-header">
        <h1 className="crm-title">Reports</h1>
      </div>
      <div className="crm-content">
        <ReportsTab />
      </div>
    </div>
  );
}
