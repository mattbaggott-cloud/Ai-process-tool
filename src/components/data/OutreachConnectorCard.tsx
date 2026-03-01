"use client";

import React, { useState, useRef } from "react";
import type { DataConnector } from "@/lib/types/database";

interface Props {
  connector: DataConnector | null;
  onRefresh: () => void;
}

interface SyncStepResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface SyncStep {
  key: string;
  label: string;
  status: "pending" | "started" | "completed" | "error";
  result?: SyncStepResult;
  error?: string;
}

export default function OutreachConnectorCard({ connector, onRefresh }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([]);
  const [syncResults, setSyncResults] = useState<Record<string, SyncStepResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const isConnected = connector?.status === "connected";
  const isError = connector?.status === "error";

  const handleConnect = () => {
    window.location.href = "/api/outreach/auth";
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/outreach/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Disconnect failed");
      setConfirmDisconnect(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResults(null);
    setSyncSteps([]);
    setError(null);
    setCurrentStepIndex(0);
    setTotalSteps(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/outreach/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          let eventName = "";
          let eventData = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }
          if (!eventData) continue;

          try {
            const payload = JSON.parse(eventData);
            handleSSEEvent(eventName, payload);
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Sync failed");
      }
    } finally {
      setSyncing(false);
      abortRef.current = null;
      onRefresh();
    }
  };

  const handleSSEEvent = (event: string, payload: Record<string, unknown>) => {
    if (event === "progress") {
      const step = payload.step as string;
      const label = payload.label as string;
      const status = payload.status as SyncStep["status"];
      const stepIndex = payload.stepIndex as number;
      const steps = payload.totalSteps as number;

      setTotalSteps(steps);
      setCurrentStepIndex(
        stepIndex + (status === "completed" || status === "error" ? 1 : 0),
      );

      setSyncSteps((prev) => {
        const existing = prev.find((s) => s.key === step);
        if (existing) {
          return prev.map((s) =>
            s.key === step
              ? { ...s, status, result: payload.result as SyncStepResult | undefined, error: payload.error as string | undefined }
              : s,
          );
        }
        return [...prev, { key: step, label, status, result: payload.result as SyncStepResult | undefined, error: payload.error as string | undefined }];
      });
    } else if (event === "done") {
      setSyncResults(payload.results as Record<string, SyncStepResult>);
    } else if (event === "error") {
      setError(payload.error as string);
    }
  };

  const formatLastSync = (date: string | null) => {
    if (!date) return "Never";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
  };

  const formatStepLabel = (key: string) => {
    const labels: Record<string, string> = {
      prospects: "Prospects",
      sequences: "Sequences",
      tasks: "Tasks",
    };
    return labels[key] || key;
  };

  const progressPercent =
    totalSteps > 0 ? Math.round((currentStepIndex / totalSteps) * 100) : 0;

  return (
    <div
      className={`data-connector-card ${isConnected ? "data-connector-card-connected" : ""} ${isError ? "data-connector-card-error" : ""} ${syncing ? "data-connector-card-syncing" : ""}`}
    >
      <div className="hubspot-card-header">
        <div className="data-connector-icon">
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div className="hubspot-card-title-row">
          <span className="data-connector-name">Outreach</span>
          {isConnected && <span className="hubspot-status-badge hubspot-status-connected">Connected</span>}
          {isError && <span className="hubspot-status-badge hubspot-status-error">Error</span>}
          {!isConnected && !isError && <span className="hubspot-status-badge hubspot-status-disconnected">Not Connected</span>}
        </div>
      </div>

      <div className="data-connector-body">
        <div className="data-connector-desc">
          {isConnected
            ? `Last synced: ${formatLastSync(connector?.last_sync_at ?? null)}`
            : isError
              ? "Connection error — try reconnecting"
              : "Sync prospects, sequences, and tasks from Outreach.io"}
        </div>

        {syncing && syncSteps.length > 0 && (
          <div className="hubspot-sync-progress">
            <div className="hubspot-sync-steps">
              {syncSteps.map((s) => (
                <div key={s.key} className={`hubspot-sync-step hubspot-sync-step-${s.status}`}>
                  <div className="hubspot-sync-step-icon">
                    {s.status === "completed" ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="7" fill="#059669" />
                        <path d="M4 7l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : s.status === "started" ? (
                      <div className="hubspot-step-spinner" />
                    ) : s.status === "error" ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="7" fill="#ef4444" />
                        <path d="M5 5l4 4M9 5l-4 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <div className="hubspot-step-pending" />
                    )}
                  </div>
                  <span className="hubspot-sync-step-label">{formatStepLabel(s.key)}</span>
                  {s.status === "completed" && s.result && (
                    <span className="hubspot-sync-step-counts">
                      {s.result.created > 0 && <span className="hubspot-count-created">+{s.result.created}</span>}
                      {s.result.errors > 0 && <span className="hubspot-count-error">{s.result.errors} errors</span>}
                      {s.result.created === 0 && s.result.errors === 0 && <span className="hubspot-count-none">no changes</span>}
                    </span>
                  )}
                  {s.status === "error" && s.error && <span className="hubspot-count-error">{s.error}</span>}
                </div>
              ))}
            </div>
            <div className="hubspot-sync-overall-bar">
              <div className="hubspot-sync-overall-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="hubspot-sync-progress-label">
              Step {Math.min(currentStepIndex + 1, totalSteps)} of {totalSteps}
            </span>
          </div>
        )}

        {syncing && syncSteps.length === 0 && (
          <div className="hubspot-sync-progress">
            <div className="hubspot-sync-overall-bar">
              <div className="hubspot-sync-overall-fill hubspot-sync-indeterminate" />
            </div>
            <span className="hubspot-sync-progress-label">Connecting to Outreach...</span>
          </div>
        )}

        {syncResults && !syncing && (
          <div className="hubspot-sync-results">
            {Object.entries(syncResults).map(([key, r]) => {
              const total = r.created + r.updated + r.skipped;
              return (
                <div key={key} className="hubspot-result-card">
                  <div className="hubspot-result-card-header">
                    <span className="hubspot-result-card-title">{formatStepLabel(key)}</span>
                    <span className="hubspot-result-card-total">{total} records</span>
                  </div>
                  <div className="hubspot-result-card-stats">
                    {r.created > 0 && <span className="hubspot-result-stat hubspot-result-stat-created">+{r.created} new</span>}
                    {r.updated > 0 && <span className="hubspot-result-stat hubspot-result-stat-updated">{r.updated} updated</span>}
                    {r.errors > 0 && <span className="hubspot-result-stat hubspot-result-stat-error">{r.errors} errors</span>}
                    {total === 0 && r.errors <= 0 && <span className="hubspot-result-stat hubspot-result-stat-skipped">No records found</span>}
                  </div>
                </div>
              );
            })}
            <button className="hubspot-dismiss-results" onClick={() => setSyncResults(null)}>Dismiss</button>
          </div>
        )}

        {error && <div className="hubspot-error-msg">{error}</div>}
      </div>

      <div className="data-connector-footer">
        {!isConnected && !isError && (
          <button className="btn btn-primary btn-sm" onClick={handleConnect}>Connect Outreach</button>
        )}
        {isError && (
          <button className="btn btn-primary btn-sm" onClick={handleConnect}>Reconnect</button>
        )}
        {isConnected && (
          <div className="hubspot-actions">
            <button className="btn btn-primary btn-sm" disabled={syncing} onClick={handleSync}>
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
            {!confirmDisconnect ? (
              <button className="btn btn-sm hubspot-disconnect-btn" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </button>
            ) : (
              <div className="hubspot-confirm-disconnect">
                <span>Disconnect?</span>
                <button className="btn btn-sm btn-danger" onClick={handleDisconnect}>Yes</button>
                <button className="btn btn-sm" onClick={() => setConfirmDisconnect(false)}>No</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
