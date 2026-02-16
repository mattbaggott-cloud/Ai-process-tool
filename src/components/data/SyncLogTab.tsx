"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { DataSyncLog } from "@/lib/types/database";

/* ── Event type badge colors ─────────────────────────────── */

const EVENT_COLORS: Record<string, { bg: string; fg: string }> = {
  info: { bg: "rgba(37,99,235,0.1)", fg: "#2563eb" },
  warning: { bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
  error: { bg: "rgba(220,38,38,0.1)", fg: "#dc2626" },
  success: { bg: "rgba(22,163,74,0.1)", fg: "#16a34a" },
};

export default function SyncLogTab() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<DataSyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("data_sync_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setLogs(data as DataSyncLog[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const handler = () => loadLogs();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadLogs]);

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="data-tab-content">
      <div className="data-toolbar">
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Sync Log</h3>
        <button className="btn btn-sm" onClick={loadLogs}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="data-empty">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="data-empty">
          <p>No activity yet</p>
          <p style={{ fontSize: 13, color: "#6b7280" }}>
            Import data or connect a source to see activity here
          </p>
        </div>
      ) : (
        <div className="data-log-list">
          {logs.map((log) => {
            const c = EVENT_COLORS[log.event_type] || EVENT_COLORS.info;
            return (
              <div key={log.id} className="data-log-item">
                <div className="data-log-item-header">
                  <span
                    className="data-status-badge"
                    style={{ backgroundColor: c.bg, color: c.fg }}
                  >
                    {log.event_type}
                  </span>
                  <span className="data-log-time">{fmtDate(log.created_at)}</span>
                </div>
                <div className="data-log-message">{log.message}</div>
                {log.details && Object.keys(log.details).length > 0 && (
                  <div className="data-log-details">
                    {Object.entries(log.details).map(([k, v]) => (
                      <span key={k} className="data-log-detail">
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
