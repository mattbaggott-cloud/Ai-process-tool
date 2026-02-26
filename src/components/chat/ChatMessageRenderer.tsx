"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

/* Lazy-load ChartRenderer (uses Recharts which is heavy) */
const ChartRenderer = dynamic(
  () => import("@/components/canvas/blocks/ChartRenderer"),
  { ssr: false, loading: () => <div className="ai-inline-loading">Loading chart...</div> }
);

/* ── Inline block types ─────────────────────────────────── */

export interface InlineTableData {
  title?: string;
  headers: string[];
  rows: string[][];
  footer?: string;
}

export interface InlineChartData {
  chart_type: "bar" | "line" | "pie" | "area";
  title?: string;
  data: Record<string, unknown>[];
  x_key: string;
  y_keys: string[];
  colors?: string[];
}

export interface InlineProfileData {
  title: string;
  sections: Array<{
    title: string;
    fields: Array<{
      label: string;
      value: string;
      confidence: "verified" | "ai_inferred" | "computed";
    }>;
  }>;
}

export interface InlineMetricData {
  title: string;
  cards: Array<{
    label: string;
    value: string;
    change?: string;
    confidence: "verified" | "ai_inferred" | "computed";
  }>;
}

export interface ClarificationData {
  question: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
  allow_freeform: boolean;
  reason: string;
}

export interface ConfidenceData {
  inferred_fields: string[];
  total_fields: number;
}

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "table"; data: InlineTableData }
  | { type: "chart"; data: InlineChartData }
  | { type: "profile"; data: InlineProfileData }
  | { type: "metric"; data: InlineMetricData }
  | { type: "clarification"; data: ClarificationData }
  | { type: "confidence"; data: ConfidenceData };

/* ── Parse message content for inline blocks ────────────── */

export const INLINE_PATTERN = /<!--(?:INLINE_(TABLE|CHART|PROFILE|METRIC)|(CLARIFICATION)|(CONFIDENCE)):([\s\S]*?)-->/g;

export function parseMessageContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(INLINE_PATTERN)) {
    const matchStart = match.index!;
    // Add text before this match
    if (matchStart > lastIndex) {
      const text = content.slice(lastIndex, matchStart).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    // match[1] = INLINE_ type (TABLE|CHART|PROFILE|METRIC)
    // match[2] = CLARIFICATION
    // match[3] = CONFIDENCE
    // match[4] = JSON payload
    const inlineType = match[1];
    const isClarification = match[2];
    const isConfidence = match[3];
    const jsonStr = match[4];

    try {
      const parsed = JSON.parse(jsonStr);
      if (inlineType === "TABLE" && parsed.headers && parsed.rows) {
        segments.push({ type: "table", data: parsed as InlineTableData });
      } else if (inlineType === "CHART" && parsed.data && parsed.x_key && parsed.y_keys) {
        segments.push({ type: "chart", data: parsed as InlineChartData });
      } else if (inlineType === "PROFILE" && parsed.sections) {
        segments.push({ type: "profile", data: parsed as InlineProfileData });
      } else if (inlineType === "METRIC" && parsed.cards) {
        segments.push({ type: "metric", data: parsed as InlineMetricData });
      } else if (isClarification && parsed.options) {
        segments.push({ type: "clarification", data: parsed as ClarificationData });
      } else if (isConfidence && parsed.inferred_fields) {
        segments.push({ type: "confidence", data: parsed as ConfidenceData });
      } else {
        // Malformed inline block — skip silently
        segments.push({ type: "text", content: "" });
      }
    } catch {
      // If JSON parsing fails, render as text
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = matchStart + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", content: text });
  }

  // If no matches found, return the whole content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

/* ── Inline Table Component ──────────────────────────────── */

export function InlineTable({ data }: { data: InlineTableData }) {
  if (!data.headers || !data.rows) {
    return <p style={{ whiteSpace: "pre-wrap", color: "#888" }}>Table data unavailable</p>;
  }
  return (
    <div className="ai-inline-table">
      {data.title && <div className="ai-inline-table-title">{data.title}</div>}
      <div className="ai-inline-table-scroll">
        <table>
          <thead>
            <tr>
              {data.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.footer && <div className="ai-inline-table-footer">{data.footer}</div>}
    </div>
  );
}

/* ── Inline Chart Component ──────────────────────────────── */

export function InlineChart({ data }: { data: InlineChartData }) {
  return (
    <div className="ai-inline-chart">
      {data.title && <div className="ai-inline-chart-title">{data.title}</div>}
      <ChartRenderer
        chartType={data.chart_type}
        chartData={data.data}
        chartConfig={{
          title: data.title,
          xKey: data.x_key,
          yKeys: data.y_keys,
          colors: data.colors,
        }}
      />
    </div>
  );
}

/* ── Inline Profile Component ──────────────────────────────── */

export function InlineProfile({ data }: { data: InlineProfileData }) {
  return (
    <div className="ai-inline-profile">
      <div className="ai-inline-profile-title">{data.title}</div>
      {data.sections.map((section, sIdx) => (
        <div key={sIdx} className="ai-inline-profile-section">
          <div className="ai-inline-profile-section-title">{section.title}</div>
          <div className="ai-inline-profile-fields">
            {section.fields.map((field, fIdx) => (
              <div key={fIdx} className="ai-inline-profile-field">
                <span className="ai-inline-profile-label">{field.label}</span>
                <span className="ai-inline-profile-value">
                  {field.value}
                  {field.confidence === "ai_inferred" && (
                    <span className="ai-inline-confidence-badge ai-inferred" title="AI-generated data">
                      AI
                    </span>
                  )}
                  {field.confidence === "computed" && (
                    <span className="ai-inline-confidence-badge computed" title="Computed from other data">
                      Calc
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Inline Metric Component ───────────────────────────────── */

export function InlineMetric({ data }: { data: InlineMetricData }) {
  return (
    <div className="ai-inline-metric">
      <div className="ai-inline-metric-title">{data.title}</div>
      <div className="ai-inline-metric-cards">
        {data.cards.map((card, cIdx) => (
          <div key={cIdx} className="ai-inline-metric-card">
            <div className="ai-inline-metric-label">{card.label}</div>
            <div className="ai-inline-metric-value">
              {card.value}
              {card.confidence === "ai_inferred" && (
                <span className="ai-inline-confidence-badge ai-inferred" title="AI-generated">AI</span>
              )}
            </div>
            {card.change && (
              <div className="ai-inline-metric-change">{card.change}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Inline Clarification Component ────────────────────────── */

export function InlineClarification({
  data,
  onSelect,
}: {
  data: ClarificationData;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="ai-inline-clarification">
      <div className="ai-inline-clarification-question">{data.question}</div>
      <div className="ai-inline-clarification-options">
        {data.options.map((option, oIdx) => (
          <button
            key={oIdx}
            className="ai-inline-clarification-option"
            onClick={() => onSelect(option.label)}
            title={option.description}
          >
            {option.label}
            {option.description && (
              <span className="ai-inline-clarification-desc">{option.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Inline Confidence Banner ──────────────────────────────── */

export function InlineConfidence({ data }: { data: ConfidenceData }) {
  if (data.inferred_fields.length === 0) return null;
  return (
    <div className="ai-inline-confidence-banner">
      <span className="ai-inline-confidence-icon" title="Some data is AI-generated">i</span>
      <span>
        Some data shown is AI-inferred ({data.inferred_fields.join(", ")}).
        These may not be 100% accurate.
      </span>
    </div>
  );
}

/* ── Rich Message Renderer ───────────────────────────────── */

export function RichMessageContent({
  content,
  onClarificationSelect,
}: {
  content: string;
  onClarificationSelect?: (value: string) => void;
}) {
  const segments = useMemo(() => parseMessageContent(content), [content]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "table") {
          return <InlineTable key={i} data={seg.data} />;
        }
        if (seg.type === "chart") {
          return <InlineChart key={i} data={seg.data} />;
        }
        if (seg.type === "profile") {
          return <InlineProfile key={i} data={seg.data} />;
        }
        if (seg.type === "metric") {
          return <InlineMetric key={i} data={seg.data} />;
        }
        if (seg.type === "clarification") {
          return <InlineClarification key={i} data={seg.data} onSelect={onClarificationSelect || (() => {})} />;
        }
        if (seg.type === "confidence") {
          return <InlineConfidence key={i} data={seg.data} />;
        }
        if (seg.type === "text") {
          return (
            <p key={i} style={{ whiteSpace: "pre-wrap" }}>
              {seg.content}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

/* ── Helper: Check if content has inline blocks ──────────── */

export function hasInlineBlocks(content: string): boolean {
  return (
    content.includes("<!--INLINE_") ||
    content.includes("<!--CLARIFICATION:") ||
    content.includes("<!--CONFIDENCE:")
  );
}
