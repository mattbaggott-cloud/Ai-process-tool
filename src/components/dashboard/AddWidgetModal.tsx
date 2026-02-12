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

type Mode = "manual" | "ai";

export default function AddWidgetModal({ onAdd, onClose }: AddWidgetModalProps) {
  const allSources = useMemo(() => getAllDataSources(), []);

  /* ── Mode toggle ── */
  const [mode, setMode] = useState<Mode>("ai");

  /* ── Manual mode state ── */
  const [sourceKey, setSourceKey] = useState(allSources[0]?.key ?? "");
  const [widgetType, setWidgetType] = useState<WidgetType>("bar");
  const [metricKey, setMetricKey] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [title, setTitle] = useState("");
  const [cols, setCols] = useState<1 | 2>(1);
  const [height, setHeight] = useState<"sm" | "md" | "lg">("md");

  /* ── AI mode state ── */
  const [aiDescription, setAiDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

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

  const showGroupBy = widgetType !== "metric" && widgetType !== "table" && widgetType !== "progress";

  /* ── AI Generate handler — builds and adds widget directly ── */
  const handleAiGenerate = async () => {
    if (!aiDescription.trim()) return;
    setAiLoading(true);
    setAiError("");

    try {
      const res = await fetch("/api/dashboard/suggest-widget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiDescription.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error || "Something went wrong");
        return;
      }

      /* Build widget directly and add it */
      const w = data.widget;
      const showGb = w.type !== "metric" && w.type !== "table" && w.type !== "progress";
      const widget: WidgetConfig = {
        id: crypto.randomUUID(),
        type: w.type,
        title: w.title || "Widget",
        data_source: w.data_source,
        metric: w.metric || "count",
        group_by: showGb ? w.group_by || undefined : undefined,
        size: w.size || { cols: 1, height: "md" },
      };
      onAdd(widget);
    } catch {
      setAiError("Failed to connect to AI. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  /* ── Add widget handler ── */
  const handleAdd = () => {
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: widgetType,
      title: title.trim() || autoTitle,
      data_source: sourceKey,
      metric: metricKey || "count",
      group_by: showGroupBy ? groupBy || undefined : undefined,
      size: { cols, height },
    };
    onAdd(widget);
  };

  return (
    <div className="add-widget-overlay" onClick={onClose}>
      <div className="add-widget-panel" onClick={(e) => e.stopPropagation()}>
        {/* ── Header bar ── */}
        <div className="add-widget-header">
          <h2>Add Widget</h2>
          <button className="add-widget-close" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* ── Body ── */}
        <div className="add-widget-body">
          {/* Mode toggle */}
          <div className="add-widget-mode-toggle">
            <button
              className={`add-widget-mode-btn ${mode === "ai" ? "active" : ""}`}
              onClick={() => setMode("ai")}
            >
              AI Generated
            </button>
            <button
              className={`add-widget-mode-btn ${mode === "manual" ? "active" : ""}`}
              onClick={() => setMode("manual")}
            >
              Manual
            </button>
          </div>

          {/* ── AI Mode ── */}
          {mode === "ai" && (
            <div className="add-widget-ai">
              <textarea
                className="add-widget-ai-textarea"
                placeholder="Describe the insight you want to see...&#10;&#10;Examples:&#10;• Show goals broken down by status&#10;• How many people are on each team?&#10;• KPI progress tracker&#10;• Pain points by severity as a pie chart"
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
              />

              {aiError && <div className="add-widget-ai-error">{aiError}</div>}
            </div>
          )}

          {/* ── Manual Mode ── */}
          {mode === "manual" && (
            <>
              {/* Row 1: Data Source + Widget Type */}
              <div className="add-widget-row">
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
              </div>

              {/* Row 2: Metric + Group By */}
              {sourceDef && (
                <div className="add-widget-row">
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
                  {showGroupBy && (
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
                </div>
              )}

              {/* Title */}
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

              {/* Size */}
              <div className="add-widget-step" style={{ marginBottom: 0 }}>
                <label>Size</label>
                <div className="add-widget-size-row">
                  <select
                    className="select"
                    value={cols}
                    onChange={(e) => setCols(Number(e.target.value) as 1 | 2)}
                  >
                    <option value={1}>1 Column</option>
                    <option value={2}>2 Columns (wide)</option>
                  </select>
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
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {mode === "ai" && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid #e5e7eb" }}>
            <button
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiDescription.trim()}
              style={{
                width: "100%",
                padding: "12px 18px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#fff",
                background: "#3b82f6",
                border: "none",
                borderRadius: "8px",
                cursor: aiLoading || !aiDescription.trim() ? "not-allowed" : "pointer",
                opacity: aiLoading || !aiDescription.trim() ? 0.5 : 1,
              }}
            >
              {aiLoading ? "Generating..." : "Generate Visual"}
            </button>
          </div>
        )}
        {mode === "manual" && (
          <div className="add-widget-actions">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleAdd}>
              Add Widget
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
