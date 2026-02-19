"use client";

import React from "react";
import type { MetricDef } from "./explorer-config";

interface ExplorerMetricsProps {
  metrics: MetricDef[];
}

export default function ExplorerMetrics({ metrics }: ExplorerMetricsProps) {
  if (metrics.length === 0) return null;

  return (
    <div className="explorer-metrics">
      {metrics.map((m, i) => (
        <div key={i} className="explorer-metric-card">
          <span className="explorer-metric-value">{m.value}</span>
          <span className="explorer-metric-label">{m.label}</span>
        </div>
      ))}
    </div>
  );
}
