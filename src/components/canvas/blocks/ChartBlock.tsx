"use client";

import React, { useRef, useEffect } from "react";
import dynamic from "next/dynamic";

/* Dynamic import — recharts doesn't work with SSR */
const ChartRenderer = dynamic(() => import("./ChartRenderer"), { ssr: false });

interface ChartBlockProps {
  chartType: "bar" | "line" | "pie" | "area";
  chartData: Record<string, unknown>[];
  chartConfig: {
    title?: string;
    xKey?: string;
    yKeys?: string[];
    colors?: string[];
  };
  onChange: (patch: {
    chartType?: "bar" | "line" | "pie" | "area";
    chartData?: Record<string, unknown>[];
    chartConfig?: {
      title?: string;
      xKey?: string;
      yKeys?: string[];
      colors?: string[];
    };
  }) => void;
}

export default function ChartBlock({
  chartType,
  chartData,
  chartConfig,
  onChange,
}: ChartBlockProps) {
  const titleRef = useRef<HTMLDivElement>(null);

  /* Sync title */
  useEffect(() => {
    if (titleRef.current && document.activeElement !== titleRef.current) {
      titleRef.current.textContent = chartConfig.title ?? "";
    }
  }, [chartConfig.title]);

  const hasData = chartData && chartData.length > 0;

  return (
    <div className="canvas-chart-block">
      {/* Header: editable title + chart type selector */}
      <div className="canvas-chart-header">
        <div
          ref={titleRef}
          className="canvas-chart-title"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Chart title…"
          onInput={() => {
            if (titleRef.current) {
              onChange({
                chartConfig: { ...chartConfig, title: titleRef.current.textContent ?? "" },
              });
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
        <select
          className="canvas-chart-type-select"
          value={chartType}
          onChange={(e) =>
            onChange({ chartType: e.target.value as "bar" | "line" | "pie" | "area" })
          }
        >
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="pie">Pie</option>
        </select>
      </div>

      {/* Chart or empty state */}
      {hasData ? (
        <ChartRenderer
          chartType={chartType}
          chartData={chartData}
          chartConfig={chartConfig}
        />
      ) : (
        <div className="canvas-chart-empty">
          <p>No data yet</p>
          <p style={{ fontSize: 12 }}>Use AI Chat to generate a chart with your data</p>
        </div>
      )}
    </div>
  );
}
