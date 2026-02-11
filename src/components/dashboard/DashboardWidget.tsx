"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { WidgetConfig } from "@/lib/types/database";
import type { WidgetQueryResult } from "@/lib/dashboard/query-engine";

const DEFAULT_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#ef4444", "#14b8a6", "#f97316"];

interface DashboardWidgetProps {
  widget: WidgetConfig;
  result: WidgetQueryResult | null;
  loading?: boolean;
  onRemove: () => void;
  /* drag handlers */
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragOver?: boolean;
  isDragging?: boolean;
}

export default function DashboardWidget({
  widget,
  result,
  loading,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
  isDragging,
}: DashboardWidgetProps) {
  const heightClass = `dashboard-widget-${widget.size.height}`;
  const spanClass = widget.size.cols === 2 ? "dashboard-widget-span-2" : "";
  const dragClass = isDragging ? "dragging" : isDragOver ? "drag-over" : "";

  return (
    <div
      className={`dashboard-widget ${heightClass} ${spanClass} ${dragClass}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="dashboard-widget-header">
        <span className="dashboard-widget-title">{widget.title}</span>
        <button className="dashboard-widget-remove" onClick={onRemove} title="Remove widget">
          &times;
        </button>
      </div>

      <div className="dashboard-widget-body">
        {loading ? (
          <div className="widget-no-data">Loading...</div>
        ) : !result ? (
          <div className="widget-no-data">No data</div>
        ) : (
          <WidgetContent widget={widget} result={result} />
        )}
      </div>
    </div>
  );
}

/* ── Inner content renderer ── */

function WidgetContent({ widget, result }: { widget: WidgetConfig; result: WidgetQueryResult }) {
  switch (result.type) {
    case "metric":
      return (
        <div className="widget-metric">
          <span className="widget-metric-value">{result.metricValue?.toLocaleString() ?? 0}</span>
          <span className="widget-metric-label">{result.metricLabel}</span>
        </div>
      );

    case "progress":
      return <ProgressContent data={result.progressData ?? []} />;

    case "table":
      return <TableContent rows={result.tableData ?? []} columns={result.tableColumns ?? []} />;

    case "chart":
      return <ChartContent type={widget.type} data={result.chartData ?? []} />;

    default:
      return <div className="widget-no-data">Unknown widget type</div>;
  }
}

/* ── Progress bars ── */

function ProgressContent({ data }: { data: { name: string; current: number; target: number }[] }) {
  if (data.length === 0) return <div className="widget-no-data">No KPI data</div>;

  return (
    <div className="widget-progress-list">
      {data.map((d) => {
        const pct = d.target > 0 ? Math.min((d.current / d.target) * 100, 150) : 0;
        const isOver = d.target > 0 && d.current >= d.target;
        return (
          <div key={d.name} className="widget-progress-row">
            <div className="widget-progress-info">
              <span className="widget-progress-name">{d.name}</span>
              <span className="widget-progress-values">
                {d.current} / {d.target}
              </span>
            </div>
            <div className="widget-progress-bar">
              <div
                className={`widget-progress-fill ${isOver ? "over-target" : ""}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Mini table ── */

function TableContent({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  if (rows.length === 0) return <div className="widget-no-data">No rows</div>;

  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      <table className="widget-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{String(row[col] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Charts (bar, pie, line) ── */

function ChartContent({
  type,
  data,
}: {
  type: string;
  data: { name: string; value: number; fill?: string }[];
}) {
  if (data.length === 0) return <div className="widget-no-data">No data</div>;

  if (type === "pie") {
    return (
      <div className="widget-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="70%"
              label={({ name }: { name?: string }) => name ?? ""}
            >
              {data.map((d, idx) => (
                <Cell key={idx} fill={d.fill || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "line") {
    return (
      <div className="widget-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* Default: bar chart */
  return (
    <div className="widget-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="value">
            {data.map((d, idx) => (
              <Cell key={idx} fill={d.fill || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
