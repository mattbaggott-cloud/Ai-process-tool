"use client";

import React, { Suspense } from "react";
import CampaignListView from "@/components/campaigns/CampaignListView";

export default function CampaignsPage() {
  return (
    <Suspense fallback={<div className="crm-loading">Loading Campaigns...</div>}>
      <CampaignListView />
    </Suspense>
  );
}
