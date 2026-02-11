/* ------------------------------------------------------------------ */
/*  Widget Query Engine                                                */
/*  Takes a WidgetConfig, queries Supabase, returns chart-ready data.  */
/* ------------------------------------------------------------------ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WidgetConfig } from "@/lib/types/database";
import { getDataSource } from "./data-sources";

/* ── Result shapes ── */

export interface ChartDataPoint {
  name: string;
  value: number;
  fill?: string;
}

export interface ProgressDataPoint {
  name: string;
  current: number;
  target: number;
}

export interface TableRow {
  [key: string]: unknown;
}

export interface WidgetQueryResult {
  type: "chart" | "metric" | "progress" | "table";
  chartData?: ChartDataPoint[];
  metricValue?: number;
  metricLabel?: string;
  progressData?: ProgressDataPoint[];
  tableData?: TableRow[];
  tableColumns?: string[];
}

/* ── Main query function ── */

export async function queryWidget(
  supabase: SupabaseClient,
  widget: WidgetConfig
): Promise<WidgetQueryResult> {
  const source = getDataSource(widget.data_source);
  if (!source) {
    return { type: "metric", metricValue: 0, metricLabel: "Unknown source" };
  }

  /* Build the Supabase query */
  let query = supabase.from(source.table).select("*");

  /* Apply filters */
  if (widget.filters) {
    for (const [field, value] of Object.entries(widget.filters)) {
      const dim = source.dimensions.find((d) => d.key === field);
      if (dim?.isArray) {
        query = query.contains(field, [value]);
      } else {
        query = query.eq(field, value);
      }
    }
  }

  const { data: rows, error } = await query;
  if (error || !rows) {
    return { type: "metric", metricValue: 0, metricLabel: "Error" };
  }

  /* ── Progress widget (special case for KPIs) ── */
  if (widget.type === "progress") {
    const progressData: ProgressDataPoint[] = rows
      .filter((r) => r.name && (r.current_value != null || r.target_value != null))
      .slice(0, 10)
      .map((r) => ({
        name: r.name as string,
        current: (r.current_value as number) ?? 0,
        target: (r.target_value as number) ?? 0,
      }));
    return { type: "progress", progressData };
  }

  /* ── Table widget ── */
  if (widget.type === "table") {
    const tableData = rows.slice(0, 10) as TableRow[];
    const columns = tableData.length > 0
      ? Object.keys(tableData[0]).filter((k) => !["id", "user_id", "created_at", "updated_at"].includes(k))
      : [];
    return { type: "table", tableData, tableColumns: columns };
  }

  /* ── Parse metric type ── */
  const metricParts = widget.metric.split(":");
  const metricType = metricParts[0]; // "count" or "sum"
  const metricField = metricParts[1]; // e.g., "headcount", "current_value"

  /* ── Metric widget (single number, no group_by) ── */
  if (widget.type === "metric" || !widget.group_by) {
    let value: number;
    if (metricType === "count") {
      value = rows.length;
    } else if (metricType === "sum" && metricField) {
      value = rows.reduce((sum, r) => sum + (Number(r[metricField]) || 0), 0);
    } else {
      value = rows.length;
    }
    return { type: "metric", metricValue: value, metricLabel: widget.title };
  }

  /* ── Chart widgets (grouped data) ── */
  const dim = source.dimensions.find((d) => d.key === widget.group_by);
  const colorMap = source.colorMap?.[widget.group_by!];

  /* Group rows by dimension */
  const groups: Record<string, number> = {};

  for (const row of rows) {
    const rawVal: unknown = row[widget.group_by!];

    /* Handle array dimensions (e.g., teams: ["Sales", "Marketing"]) */
    if (dim?.isArray && Array.isArray(rawVal)) {
      for (const v of rawVal as string[]) {
        const key = v || "(none)";
        if (metricType === "sum" && metricField) {
          groups[key] = (groups[key] ?? 0) + (Number(row[metricField]) || 0);
        } else {
          groups[key] = (groups[key] ?? 0) + 1;
        }
      }
    } else {
      const key = String(rawVal ?? "(none)");
      if (metricType === "sum" && metricField) {
        groups[key] = (groups[key] ?? 0) + (Number(row[metricField]) || 0);
      } else {
        groups[key] = (groups[key] ?? 0) + 1;
      }
    }
  }

  /* Convert to chart data points */
  const chartData: ChartDataPoint[] = Object.entries(groups)
    .map(([name, value]) => ({
      name,
      value,
      fill: colorMap?.[name],
    }))
    .sort((a, b) => b.value - a.value);

  return { type: "chart", chartData };
}
