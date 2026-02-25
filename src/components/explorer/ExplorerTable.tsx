"use client";

import React from "react";
import { StatusBadge, formatCurrency } from "@/components/crm/shared";
import { formatDate, formatNumber, SOURCE_COLORS } from "./explorer-config";
import type { ColumnDef, EntityType } from "./explorer-config";

/* ── Row type ─────────────────────────────────────────────── */

export interface ExplorerRow {
  id: string;
  _entityType: EntityType;
  _source: string;
  [key: string]: unknown;
}

/* ── Source Badge ──────────────────────────────────────────── */

/** Label map for source names */
const SOURCE_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  shopify: "Shopify",
  klaviyo: "Klaviyo",
  import: "CSV Import",
  both: "Linked",
  manual: "Manual",
};

function SourcePill({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? "#6b7280";
  const label = SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
  return (
    <span
      className="explorer-source-badge"
      style={{ backgroundColor: color + "18", color, borderColor: color + "40" }}
    >
      <span className="explorer-source-dot" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/**
 * SourceBadge — shows one or more source pills.
 * When `_sources` array is available on the row, shows individual pills for each source.
 * Falls back to single source string for backwards compat.
 */
function SourceBadge({ source, sources }: { source: string; sources?: string[] }) {
  // Multi-source: show individual pills for each linked source
  if (sources && sources.length > 1) {
    return (
      <span className="explorer-source-multi">
        {sources.map((s) => (
          <SourcePill key={s} source={s} />
        ))}
      </span>
    );
  }
  return <SourcePill source={source} />;
}

/* ── Cell Renderer ────────────────────────────────────────── */

function CellContent({ value, render, row }: { value: unknown; render: ColumnDef["render"]; row?: ExplorerRow }) {
  if (value == null || value === "") return <span className="explorer-cell-empty">—</span>;

  switch (render) {
    case "currency":
      return <>{formatCurrency(value as number)}</>;
    case "date":
      return <>{formatDate(value as string)}</>;
    case "status":
      return <StatusBadge status={value as string} />;
    case "source_badge":
      return <SourceBadge source={value as string} sources={row?._sources as string[] | undefined} />;
    case "number":
      return <>{formatNumber(value as number)}</>;
    case "boolean":
      return <>{value ? "Yes" : "No"}</>;
    case "tags":
      return <>{Array.isArray(value) ? value.join(", ") : String(value)}</>;
    default:
      return <>{String(value)}</>;
  }
}

/* ── Table Component ──────────────────────────────────────── */

interface ExplorerTableProps {
  rows: ExplorerRow[];
  columns: ColumnDef[];
  sortField: string;
  sortDirection: "asc" | "desc";
  onSort: (field: string) => void;
  loading?: boolean;
}

export default function ExplorerTable({
  rows,
  columns,
  sortField,
  sortDirection,
  onSort,
  loading,
}: ExplorerTableProps) {
  if (loading) {
    return <div className="explorer-table-loading">Loading data...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="explorer-table-empty">
        <p>No data found</p>
        <span>Try adjusting your filters or connect a data source.</span>
      </div>
    );
  }

  return (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`crm-th ${col.sortable ? "explorer-sortable" : ""}`}
                onClick={col.sortable ? () => onSort(col.key) : undefined}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
                {col.sortable && sortField === col.key && (
                  <span className="explorer-sort-arrow">
                    {sortDirection === "asc" ? " ▲" : " ▼"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={`${row.id}-${ri}`} className="crm-table-row">
              {columns.map((col, ci) => (
                <td
                  key={col.key}
                  className={ci === 0 ? "crm-cell-name" : ""}
                >
                  <CellContent value={row[col.key]} render={col.render} row={row} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
