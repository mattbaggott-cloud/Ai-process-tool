"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { Dashboard, WidgetConfig } from "@/lib/types/database";
import type { WidgetQueryResult } from "@/lib/dashboard/query-engine";
import { queryWidget } from "@/lib/dashboard/query-engine";
import DashboardWidget from "@/components/dashboard/DashboardWidget";
import AddWidgetModal from "@/components/dashboard/AddWidgetModal";

/* ── Default widgets for first-time users ── */

const DEFAULT_WIDGETS: WidgetConfig[] = [
  {
    id: crypto.randomUUID(),
    type: "bar",
    title: "Goals by Status",
    data_source: "goals",
    metric: "count",
    group_by: "status",
    size: { cols: 1, height: "md" },
  },
  {
    id: crypto.randomUUID(),
    type: "pie",
    title: "Pain Points by Severity",
    data_source: "pain_points",
    metric: "count",
    group_by: "severity",
    size: { cols: 1, height: "md" },
  },
  {
    id: crypto.randomUUID(),
    type: "metric",
    title: "Total Headcount",
    data_source: "team_roles",
    metric: "sum:headcount",
    size: { cols: 1, height: "sm" },
  },
  {
    id: crypto.randomUUID(),
    type: "metric",
    title: "Active Goals",
    data_source: "goals",
    metric: "count",
    filters: { status: "In Progress" },
    size: { cols: 1, height: "sm" },
  },
  {
    id: crypto.randomUUID(),
    type: "progress",
    title: "KPI Tracker",
    data_source: "team_kpis",
    metric: "sum:current_value",
    size: { cols: 2, height: "md" },
  },
  {
    id: crypto.randomUUID(),
    type: "bar",
    title: "Tech Stack by Status",
    data_source: "stack_tools",
    metric: "count",
    group_by: "status",
    size: { cols: 2, height: "md" },
  },
];

/* ================================================================== */

export default function DashboardsPage() {
  const { user } = useAuth();
  const supabase = createClient();

  /* ── State ── */
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [widgetResults, setWidgetResults] = useState<Record<string, WidgetQueryResult | null>>({});
  const [loadingWidgets, setLoadingWidgets] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  const activeDashboard = dashboards[activeIdx] ?? null;

  /* ── Load dashboards ── */
  const loadDashboards = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("dashboards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at");

    if (data && data.length > 0) {
      setDashboards(data as Dashboard[]);
    } else {
      /* First visit: create default dashboard */
      const { data: created } = await supabase
        .from("dashboards")
        .insert({
          user_id: user.id,
          name: "My Dashboard",
          widgets: DEFAULT_WIDGETS,
          is_default: true,
        })
        .select()
        .single();
      if (created) setDashboards([created as Dashboard]);
    }
    setPageLoading(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadDashboards();
  }, [loadDashboards]);

  /* ── Query all widgets when dashboard changes ── */
  const queryAllWidgets = useCallback(
    async (widgets: WidgetConfig[]) => {
      if (!widgets.length) return;
      const loading = new Set(widgets.map((w) => w.id));
      setLoadingWidgets(loading);

      const results: Record<string, WidgetQueryResult | null> = {};
      await Promise.all(
        widgets.map(async (w) => {
          try {
            results[w.id] = await queryWidget(supabase, w);
          } catch {
            results[w.id] = null;
          }
        })
      );
      setWidgetResults(results);
      setLoadingWidgets(new Set());
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (activeDashboard) {
      queryAllWidgets(activeDashboard.widgets);
    }
  }, [activeDashboard?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Debounced save ── */
  const saveDashboard = useCallback(
    (updated: Dashboard) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await supabase
          .from("dashboards")
          .update({ widgets: updated.widgets, name: updated.name, updated_at: new Date().toISOString() })
          .eq("id", updated.id);
      }, 1000);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Update active dashboard helper ── */
  const updateActive = useCallback(
    (updater: (d: Dashboard) => Dashboard) => {
      setDashboards((prev) => {
        const next = [...prev];
        next[activeIdx] = updater(next[activeIdx]);
        saveDashboard(next[activeIdx]);
        return next;
      });
    },
    [activeIdx, saveDashboard]
  );

  /* ── Add widget ── */
  const handleAddWidget = useCallback(
    (widget: WidgetConfig) => {
      updateActive((d) => ({ ...d, widgets: [...d.widgets, widget] }));
      setShowAddModal(false);
      /* Query the new widget */
      (async () => {
        setLoadingWidgets((prev) => new Set(prev).add(widget.id));
        try {
          const result = await queryWidget(supabase, widget);
          setWidgetResults((prev) => ({ ...prev, [widget.id]: result }));
        } catch {
          setWidgetResults((prev) => ({ ...prev, [widget.id]: null }));
        }
        setLoadingWidgets((prev) => {
          const next = new Set(prev);
          next.delete(widget.id);
          return next;
        });
      })();
    },
    [updateActive] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Remove widget ── */
  const handleRemoveWidget = useCallback(
    (widgetId: string) => {
      updateActive((d) => ({
        ...d,
        widgets: d.widgets.filter((w) => w.id !== widgetId),
      }));
    },
    [updateActive]
  );

  /* ── Drag & drop reorder ── */
  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    updateActive((d) => {
      const widgets = [...d.widgets];
      const [moved] = widgets.splice(dragIdx, 1);
      widgets.splice(idx, 0, moved);
      return { ...d, widgets };
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  /* ── Rename dashboard ── */
  const handleRename = (e: React.FocusEvent<HTMLInputElement>) => {
    const name = e.target.value.trim();
    if (name && activeDashboard) {
      updateActive((d) => ({ ...d, name }));
    }
  };

  /* ── New dashboard ── */
  const handleNewDashboard = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("dashboards")
      .insert({
        user_id: user.id,
        name: `Dashboard ${dashboards.length + 1}`,
        widgets: [],
        is_default: false,
      })
      .select()
      .single();
    if (data) {
      setDashboards((prev) => [...prev, data as Dashboard]);
      setActiveIdx(dashboards.length);
    }
  };

  /* ── Delete dashboard ── */
  const handleDeleteDashboard = async () => {
    if (!activeDashboard || dashboards.length <= 1) return;
    await supabase.from("dashboards").delete().eq("id", activeDashboard.id);
    setDashboards((prev) => prev.filter((d) => d.id !== activeDashboard.id));
    setActiveIdx(0);
  };

  /* ── Loading state ── */
  if (pageLoading) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-content">
          <p style={{ color: "var(--text-secondary)" }}>Loading dashboards...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {/* ── Tab bar (Chrome-style with shaded background) ── */}
      <div className="dashboard-tab-bar">
        {dashboards.map((d, i) => (
          <button
            key={d.id}
            className={`dashboard-tab ${i === activeIdx ? "active" : ""}`}
            onClick={() => setActiveIdx(i)}
          >
            {d.name}
            {dashboards.length > 1 && (
              <span
                className="dashboard-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  if (i === activeIdx) handleDeleteDashboard();
                  else {
                    supabase.from("dashboards").delete().eq("id", d.id);
                    setDashboards((prev) => prev.filter((_, idx) => idx !== i));
                    if (activeIdx > i) setActiveIdx((prev) => prev - 1);
                  }
                }}
              >
                &times;
              </span>
            )}
          </button>
        ))}
        <button className="dashboard-new-tab" onClick={handleNewDashboard} title="New dashboard">
          +
        </button>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="dashboard-content">
        {/* ── Header ── */}
        {activeDashboard && (
          <div className="dashboard-header">
            <input
              className="dashboard-title-input"
              defaultValue={activeDashboard.name}
              key={activeDashboard.id}
              onBlur={handleRename}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <div className="dashboard-actions">
              <button className="dashboard-action-link" onClick={() => setShowAddModal(true)}>
                + Add widget
              </button>
            </div>
          </div>
        )}

        {/* ── Widget grid ── */}
        {activeDashboard && (
          <div className="dashboard-grid">
            {activeDashboard.widgets.length === 0 ? (
              <div className="dashboard-grid-empty">
                No widgets yet. Click <strong>+ Add widget</strong> above to get started.
              </div>
            ) : (
              activeDashboard.widgets.map((widget, idx) => (
                <DashboardWidget
                  key={widget.id}
                  widget={widget}
                  result={widgetResults[widget.id] ?? null}
                  loading={loadingWidgets.has(widget.id)}
                  onRemove={() => handleRemoveWidget(widget.id)}
                  onDragStart={handleDragStart(idx)}
                  onDragOver={handleDragOver(idx)}
                  onDrop={handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  isDragOver={dragOverIdx === idx}
                  isDragging={dragIdx === idx}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Add widget modal ── */}
      {showAddModal && (
        <AddWidgetModal
          onAdd={handleAddWidget}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
