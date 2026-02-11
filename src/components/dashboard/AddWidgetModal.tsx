"use client";

import React, { useState, useMemo } from "react";
import type { WidgetConfig, WidgetType } from "@/lib/types/database";
import { getAllDataSources, getDataSource } from "@/lib/dashboard/data-sources";

interface AddWidgetModalProps {
  onAdd: (widget: WidgetConfig) => void;
  onClose: () => void;
}

const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "bar", label: "Bar Chart" },
  { value: "pie", label: "Pie Chart" },
  { value: "line", label: "Line Chart" },
  { value: "metric", label: "Metric (Number)" },
  { value: "table", label: "Table" },
  { value: "progress", label: "Progress Bars" },
];

export default function AddWidgetModal({ onAdd, onClose }: AddWidgetModalProps) {
  const allSources = useMemo(() => getAllDataSources(), []);

  const [sourceKey, setSourceKey] = useState(allSources[0]?.key ?? "");
  const [widgetType, setWidgetType] = useState<WidgetType>("bar");
  const [metricKey, setMetricKey] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [title, setTitle] = useState("");
  const [cols, setCols] = useState<1 | 2>(1);
  const [height, setHeight] = useState<"sm" | "md" | "lg">("md");

  /* Derived: current source def */
  const sourceDef = useMemo(() => getDataSource(sourceKey), [sourceKey]);

  /* Auto-select first metric when source changes */
  React.useEffect(() => {
    if (sourceDef) {
      setMetricKey(sourceDef.metrics[0]?.key ?? "count");
      setGroupBy(sourceDef.dimensions[0]?.key ?? "");
    }
  }, [sourceDef]);

  /* Auto-generate title */
  const autoTitle = useMemo(() => {
    if (!sourceDef) return "Widget";
    const metricLabel = sourceDef.metrics.find((m) => m.key === metricKey)?.label ?? "Count";
    const dimLabel = sourceDef.dimensions.find((d) => d.key === groupBy)?.label;

    if (widgetType === "metric") return `${metricLabel} - ${sourceDef.label}`;
    if (widgetType === "progress") return `${sourceDef.label} Progress`;
    if (widgetType === "table") return `${sourceDef.label} Table`;
    if (dimLabel) return `${sourceDef.label} by ${dimLabel}`;
    return `${sourceDef.label} ${metricLabel}`;
  }, [sourceDef, metricKey, groupBy, widgetType]);

  const handleAdd = () => {
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: widgetType,
      title: title.trim() || autoTitle,
      data_source: sourceKey,
      metric: metricKey || "count",
      group_by: (widgetType !== "metric" && widgetType !== "table" && widgetType !== "progress") ? groupBy || undefined : undefined,
      size: { cols, height },
    };
    onAdd(widget);
  };

  return (
    <div className="add-widget-overlay" onClick={onClose}>
      <div className="add-widget-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Add Widget</h2>

        {/* Step 1: Data source */}
        <div className="add-widget-step">
          <label>Data Source</label>
          <select
            className="select"
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
          >
            {allSources.map((s) => (
              <option key={s.key} value={s.key}>{s.def.label}</option>
            ))}
          </select>
        </div>

        {/* Step 2: Widget type */}
        <div className="add-widget-step">
          <label>Widget Type</label>
          <select
            className="select"
            value={widgetType}
            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
          >
            {WIDGET_TYPES.map((wt) => (
              <option key={wt.value} value={wt.value}>{wt.label}</option>
            ))}
          </select>
        </div>

        {/* Step 3: Metric */}
        {sourceDef && (
          <div className="add-widget-step">
            <label>Metric</label>
            <select
              className="select"
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
            >
              {sourceDef.metrics.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Step 4: Group by (only for chart types) */}
        {sourceDef && widgetType !== "metric" && widgetType !== "table" && widgetType !== "progress" && (
          <div className="add-widget-step">
            <label>Group By</label>
            <select
              className="select"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              {sourceDef.dimensions.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Step 5: Title */}
        <div className="add-widget-step">
          <label>Title</label>
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={autoTitle}
          />
        </div>

        {/* Step 6: Size */}
        <div className="add-widget-step">
          <label>Size</label>
          <div className="add-widget-size-row">
            <div>
              <select
                className="select"
                value={cols}
                onChange={(e) => setCols(Number(e.target.value) as 1 | 2)}
              >
                <option value={1}>1 Column</option>
                <option value={2}>2 Columns (wide)</option>
              </select>
            </div>
            <div>
              <select
                className="select"
                value={height}
                onChange={(e) => setHeight(e.target.value as "sm" | "md" | "lg")}
              >
                <option value="sm">Small</option>
                <option value="md">Medium</option>
                <option value="lg">Large</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="add-widget-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleAdd}>
            Add Widget
          </button>
        </div>
      </div>
    </div>
  );
}
