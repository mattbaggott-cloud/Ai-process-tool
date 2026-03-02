"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import {
  SlashPipelineView,
  SlashPeopleView,
  SlashAccountsView,
  SlashKnowledgeView,
  SlashCampaignsView,
  SlashProjectsView,
  SlashCustomersView,
  SlashOrdersView,
  SlashProductsView,
  SlashDashboardView,
  SlashToolsView,
  SlashGoalsView,
  SlashPainpointsView,
  SlashCadenceView,
  SlashOrganizationView,
  SlashDataView,
  SlashTasksView,
} from "@/components/chat/SlashViews";

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

/* ── Slash View Data Types ─────────────────────────────── */

export interface SlashPipelineData {
  total_deals: number;
  active_deals: number;
  total_value: number;
  weighted_value: number;
  won_value: number;
  columns: Array<{
    stage: string;
    label: string;
    color: string;
    deal_count: number;
    total_value: number;
    deals: Array<{
      id: string;
      title: string;
      value: number;
      currency: string;
      probability: number;
      contact_name: string;
      company_name: string;
      expected_close_date: string | null;
      days_in_stage: number;
    }>;
  }>;
}

export interface SlashPeopleData {
  total_contacts: number;
  by_status: Record<string, number>;
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    title: string;
    company_name: string;
    status: string;
    source: string;
    last_activity: string | null;
    created_at: string;
  }>;
}

export interface SlashAccountsData {
  total_companies: number;
  companies: Array<{
    id: string;
    name: string;
    domain: string;
    industry: string;
    size: string;
    contact_count: number;
    deal_count: number;
    total_deal_value: number;
    annual_revenue: number | null;
    created_at: string;
  }>;
}

export interface SlashKnowledgeData {
  total_items: number;
  by_category: Record<string, number>;
  items: Array<{
    id: string;
    title: string;
    category: string;
    tags: string[];
    content_preview: string;
    updated_at: string;
    created_at: string;
  }>;
}

export interface SlashCampaignsData {
  total_campaigns: number;
  by_status: Record<string, number>;
  by_category?: Record<string, number>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    campaign_type: string;
    campaign_category?: string;
    delivery_channel?: string;
    step_count?: number;
    channels?: string[];
    pending_tasks?: number;
    variant_count: number;
    sent_count: number;
    open_rate: number | null;
    click_rate: number | null;
    sent_at: string | null;
    created_at: string;
  }>;
}

export interface SlashProjectsData {
  total_projects: number;
  by_mode: Record<string, number>;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    active_mode: string;
    block_count: number;
    node_count: number;
    message_count: number;
    updated_at: string;
    created_at: string;
  }>;
}

export interface SlashCustomersData {
  total_customers: number;
  total_revenue: number;
  avg_order_value: number;
  customers: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    order_count: number;
    total_spent: number;
    last_order_date: string | null;
    created_at: string;
  }>;
}

export interface SlashOrdersData {
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  by_status: Record<string, number>;
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    financial_status: string;
    item_count: number;
    total_price: number;
    created_at: string;
  }>;
}

export interface SlashProductsData {
  total_products: number;
  by_type: Record<string, number>;
  products: Array<{
    id: string;
    title: string;
    product_type: string;
    price: number;
    variant_count: number;
    total_sold: number;
    status: string;
  }>;
}

export interface SlashDashboardData {
  sections: Array<{
    title: string;
    metrics: Array<{
      label: string;
      value: string;
      change?: string;
      trend?: "up" | "down" | "neutral";
    }>;
  }>;
  highlights: Array<{
    icon: string;
    text: string;
  }>;
}

export interface SlashToolsData {
  total: number;
  status_counts: Record<string, number>;
  category_counts: Record<string, number>;
  tools: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    teams: string[];
    team_usage: Record<string, string>;
    status: string;
  }>;
}

export interface SlashGoalsData {
  total: number;
  total_sub_goals: number;
  status_counts: Record<string, number>;
  goals: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    owner: string;
    teams: string[];
    start_date: string | null;
    end_date: string | null;
    metric: string;
    metric_target: string;
    sub_goals: Array<{ id: string; name: string; status: string }>;
  }>;
}

export interface SlashPainpointsData {
  total: number;
  severity_counts: Record<string, number>;
  status_counts: Record<string, number>;
  pain_points: Array<{
    id: string;
    name: string;
    description: string;
    severity: string;
    status: string;
    teams: string[];
    owner: string;
    impact_metric: string;
    linked_goal: string | null;
  }>;
}

export interface SlashCadenceData {
  total: number;
  status_counts: Record<string, number>;
  channel_counts: Record<string, number>;
  cadences: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    target_persona: string;
    total_steps: number;
    total_days: number;
    channels: string[];
    steps: Array<{ day: number; channel: string; action: string }>;
  }>;
}

export interface SlashOrganizationData {
  name: string;
  description: string;
  industry: string;
  website: string;
  stage: string;
  target_market: string;
  differentiators: string;
  notes: string;
  created_at: string | null;
  member_count: number;
  members: Array<{
    role: string;
    display_name: string | null;
    job_title: string | null;
    department: string | null;
    joined_at: string | null;
  }>;
}

export interface SlashTasksData {
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    overdue: number;
    my_tasks: number;
  };
  by_type: Record<string, number>;
  by_source: Record<string, number>;
  tasks: Array<{
    id: string;
    source: "task" | "campaign_task";
    title: string;
    task_type: string;
    priority: string | null;
    status: string;
    due_at: string | null;
    tags: string[];
    campaign_name: string | null;
    contact_name: string | null;
    is_mine: boolean;
    created_at: string;
  }>;
}

export interface SlashDataData {
  total_connectors: number;
  active_connectors: number;
  connectors: Array<{
    id: string;
    type: string;
    name: string;
    status: string;
    last_sync: string | null;
    created_at: string;
  }>;
  recent_imports: Array<{
    id: string;
    type: string;
    source: string;
    status: string;
    row_count: number;
    created_at: string;
  }>;
  available_types: string[];
}

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "table"; data: InlineTableData }
  | { type: "chart"; data: InlineChartData }
  | { type: "profile"; data: InlineProfileData }
  | { type: "metric"; data: InlineMetricData }
  | { type: "clarification"; data: ClarificationData }
  | { type: "confidence"; data: ConfidenceData }
  | { type: "slash_pipeline"; data: SlashPipelineData }
  | { type: "slash_people"; data: SlashPeopleData }
  | { type: "slash_accounts"; data: SlashAccountsData }
  | { type: "slash_knowledge"; data: SlashKnowledgeData }
  | { type: "slash_campaigns"; data: SlashCampaignsData }
  | { type: "slash_projects"; data: SlashProjectsData }
  | { type: "slash_customers"; data: SlashCustomersData }
  | { type: "slash_orders"; data: SlashOrdersData }
  | { type: "slash_products"; data: SlashProductsData }
  | { type: "slash_dashboard"; data: SlashDashboardData }
  | { type: "slash_tools"; data: SlashToolsData }
  | { type: "slash_goals"; data: SlashGoalsData }
  | { type: "slash_painpoints"; data: SlashPainpointsData }
  | { type: "slash_cadence"; data: SlashCadenceData }
  | { type: "slash_organization"; data: SlashOrganizationData }
  | { type: "slash_data"; data: SlashDataData }
  | { type: "slash_tasks"; data: SlashTasksData };

/* ── Parse message content for inline blocks ────────────── */

export const INLINE_PATTERN = /<!--(?:INLINE_(TABLE|CHART|PROFILE|METRIC)|(CLARIFICATION)|(CONFIDENCE)|(SLASH_(?:PIPELINE|PEOPLE|ACCOUNTS|KNOWLEDGE|CAMPAIGNS|PROJECTS|CUSTOMERS|ORDERS|PRODUCTS|DASHBOARD|TOOLS|GOALS|PAINPOINTS|CADENCE|ORGANIZATION|DATA|TASKS))):([\s\S]*?)-->/g;

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
    // match[4] = SLASH_ type (SLASH_PIPELINE|SLASH_PEOPLE|SLASH_ACCOUNTS|SLASH_KNOWLEDGE)
    // match[5] = JSON payload
    const inlineType = match[1];
    const isClarification = match[2];
    const isConfidence = match[3];
    const slashType = match[4];
    const jsonStr = match[5];

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
      } else if (slashType === "SLASH_PIPELINE" && parsed.columns) {
        segments.push({ type: "slash_pipeline", data: parsed as SlashPipelineData });
      } else if (slashType === "SLASH_PEOPLE" && parsed.contacts) {
        segments.push({ type: "slash_people", data: parsed as SlashPeopleData });
      } else if (slashType === "SLASH_ACCOUNTS" && parsed.companies) {
        segments.push({ type: "slash_accounts", data: parsed as SlashAccountsData });
      } else if (slashType === "SLASH_KNOWLEDGE") {
        segments.push({ type: "slash_knowledge", data: parsed as SlashKnowledgeData });
      } else if (slashType === "SLASH_CAMPAIGNS" && parsed.campaigns) {
        segments.push({ type: "slash_campaigns", data: parsed as SlashCampaignsData });
      } else if (slashType === "SLASH_PROJECTS" && parsed.projects) {
        segments.push({ type: "slash_projects", data: parsed as SlashProjectsData });
      } else if (slashType === "SLASH_CUSTOMERS" && parsed.customers) {
        segments.push({ type: "slash_customers", data: parsed as SlashCustomersData });
      } else if (slashType === "SLASH_ORDERS" && parsed.orders) {
        segments.push({ type: "slash_orders", data: parsed as SlashOrdersData });
      } else if (slashType === "SLASH_PRODUCTS" && parsed.products) {
        segments.push({ type: "slash_products", data: parsed as SlashProductsData });
      } else if (slashType === "SLASH_DASHBOARD" && parsed.sections) {
        segments.push({ type: "slash_dashboard", data: parsed as SlashDashboardData });
      } else if (slashType === "SLASH_TOOLS" && parsed.tools) {
        segments.push({ type: "slash_tools", data: parsed as SlashToolsData });
      } else if (slashType === "SLASH_GOALS") {
        segments.push({ type: "slash_goals", data: parsed as SlashGoalsData });
      } else if (slashType === "SLASH_PAINPOINTS") {
        segments.push({ type: "slash_painpoints", data: parsed as SlashPainpointsData });
      } else if (slashType === "SLASH_CADENCE") {
        segments.push({ type: "slash_cadence", data: parsed as SlashCadenceData });
      } else if (slashType === "SLASH_ORGANIZATION") {
        segments.push({ type: "slash_organization", data: parsed as SlashOrganizationData });
      } else if (slashType === "SLASH_DATA") {
        segments.push({ type: "slash_data", data: parsed as SlashDataData });
      } else if (slashType === "SLASH_TASKS") {
        segments.push({ type: "slash_tasks", data: parsed as SlashTasksData });
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

  // Deduplicate slash views — only keep the first of each type (safety net against double-streaming)
  const seenSlashTypes = new Set<string>();
  const deduped = segments.filter((seg) => {
    if (seg.type.startsWith("slash_")) {
      if (seenSlashTypes.has(seg.type)) return false;
      seenSlashTypes.add(seg.type);
    }
    return true;
  });

  return deduped;
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
        if (seg.type === "slash_pipeline") {
          return <SlashPipelineView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_people") {
          return <SlashPeopleView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_accounts") {
          return <SlashAccountsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_knowledge") {
          return <SlashKnowledgeView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_campaigns") {
          return <SlashCampaignsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_projects") {
          return <SlashProjectsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_customers") {
          return <SlashCustomersView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_orders") {
          return <SlashOrdersView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_products") {
          return <SlashProductsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_dashboard") {
          return <SlashDashboardView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_tools") {
          return <SlashToolsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_goals") {
          return <SlashGoalsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_painpoints") {
          return <SlashPainpointsView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_cadence") {
          return <SlashCadenceView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_organization") {
          return <SlashOrganizationView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_data") {
          return <SlashDataView key={i} data={seg.data} />;
        }
        if (seg.type === "slash_tasks") {
          return <SlashTasksView key={i} data={seg.data} />;
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
    content.includes("<!--CONFIDENCE:") ||
    content.includes("<!--SLASH_")
  );
}
