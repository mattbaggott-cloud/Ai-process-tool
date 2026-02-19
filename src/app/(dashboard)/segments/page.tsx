"use client";

import React, { Suspense } from "react";
import SegmentsView from "@/components/segments/SegmentsView";

export default function SegmentsPage() {
  return (
    <Suspense fallback={<div className="crm-loading">Loading Segments...</div>}>
      <SegmentsView />
    </Suspense>
  );
}
