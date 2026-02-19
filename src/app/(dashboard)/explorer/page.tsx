"use client";

import React, { Suspense } from "react";
import ExplorerView from "@/components/explorer/ExplorerView";

export default function ExplorerPage() {
  return (
    <Suspense fallback={<div className="crm-loading">Loading Explorer...</div>}>
      <ExplorerView />
    </Suspense>
  );
}
