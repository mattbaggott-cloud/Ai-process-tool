"use client";

import React, { useState, useCallback } from "react";
import { SOURCE_COLORS } from "./explorer-config";

/* ================================================================ */
/*  Types                                                            */
/* ================================================================ */

interface TierStat {
  tier: number;
  label: string;
  count: number;
  needsReview: number;
}

interface Candidate {
  id: string;
  source_a_type: string;
  source_a_label: string;
  source_b_type: string;
  source_b_label: string;
  match_tier: number;
  confidence: number;
  match_signals: string[];
  matched_on: string;
  needs_review: boolean;
  status: string;
}

interface RunInfo {
  id: string;
  status: string;
  computed_at: string;
  applied_at?: string;
  reversed_at?: string;
  stats: Record<string, unknown>;
}

type PanelState =
  | { step: "idle" }
  | { step: "computing" }
  | { step: "review"; runId: string; byTier: TierStat[]; candidates: Candidate[]; totalScanned: number; durationMs: number }
  | { step: "applying" }
  | { step: "applied"; runId: string; edgesCreated: number; edgesExisting: number }
  | { step: "reversing" }
  | { step: "error"; message: string };

interface IdentityResolutionPanelProps {
  multiSourceCount: number;
  onResolutionComplete: () => void;
}

/* ================================================================ */
/*  Helpers                                                          */
/* ================================================================ */

const SOURCE_LABELS: Record<string, string> = {
  crm_contacts: "HubSpot",
  ecom_customers: "Shopify",
  klaviyo_profiles: "Klaviyo",
};

const SOURCE_KEYS: Record<string, string> = {
  crm_contacts: "hubspot",
  ecom_customers: "shopify",
  klaviyo_profiles: "klaviyo",
};

function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "#16a34a"; // green
  if (confidence >= 0.7) return "#ca8a04"; // amber
  return "#dc2626"; // red
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.7) return "Medium";
  return "Low";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ================================================================ */
/*  Component                                                        */
/* ================================================================ */

export default function IdentityResolutionPanel({
  multiSourceCount,
  onResolutionComplete,
}: IdentityResolutionPanelProps) {
  const [state, setState] = useState<PanelState>({ step: "idle" });
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunInfo[]>([]);

  /* ── Step 1: Compute ────────────────────────────── */
  const handleCompute = useCallback(async () => {
    setState({ step: "computing" });
    setRejectedIds(new Set());

    try {
      const res = await fetch("/api/identity/resolve", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Compute failed");
      }
      const data = await res.json();

      // Load candidates for this run
      const candidatesRes = await fetch(`/api/identity/resolve?_=${Date.now()}`);
      const statsData = await candidatesRes.json();

      // We need the actual candidate rows — load them from the run
      const runId = data.run_id as string;
      setState({
        step: "review",
        runId,
        byTier: data.by_tier as TierStat[],
        candidates: [], // Will be populated from inline data
        totalScanned: data.total_records_scanned,
        durationMs: data.duration_ms,
      });

      // Load candidates from DB for the review panel
      await loadCandidates(runId);

      if (statsData.recent_runs) {
        setRecentRuns(statsData.recent_runs);
      }
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Compute failed" });
    }
  }, []);

  /* ── Load candidates for a run ──────────────────── */
  const loadCandidates = useCallback(async (runId: string) => {
    // Use the GET endpoint which now returns pending run info
    // But we need actual candidates — fetch them directly
    try {
      // For now we use a simple approach: we already have by_tier stats from compute
      // We'll load candidate details via a fetch to a candidates endpoint
      // Since we don't have a separate candidates endpoint, we'll use the supabase client
      // Actually, let's call GET /api/identity/resolve which returns the pending run
      // and we'll add a candidates query param

      // Workaround: We store the full candidate data in state from the POST response
      // The POST doesn't return individual candidates, only summaries.
      // Let's create an inline fetch using the data from the run

      // Actually the simplest approach: use the identity_match_candidates table
      // We need a small API to list candidates by run_id
      // For the MVP, let's call the same GET endpoint with run_id

      // Simplest MVP: fetch the candidates via the generic stats endpoint
      // which already returns pending_run info
      const res = await fetch(`/api/identity/resolve/candidates?run_id=${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.candidates) {
          setState((prev) => {
            if (prev.step !== "review") return prev;
            return { ...prev, candidates: data.candidates };
          });
        }
      }
    } catch {
      // Non-fatal — candidates just won't be shown inline
    }
  }, []);

  /* ── Step 2: Apply ──────────────────────────────── */
  const handleApply = useCallback(async (runId: string, acceptAll: boolean) => {
    setState({ step: "applying" });

    try {
      const body: Record<string, unknown> = { run_id: runId };
      if (!acceptAll && rejectedIds.size > 0) {
        body.rejected_ids = [...rejectedIds];
      }

      const res = await fetch("/api/identity/resolve/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Apply failed");
      }

      const data = await res.json();
      setState({
        step: "applied",
        runId,
        edgesCreated: data.edges_created,
        edgesExisting: data.edges_existing,
      });
      // Don't call onResolutionComplete() here — it triggers loadData() which
      // would set loading=true and cause a re-render. Instead, we call it when
      // the user clicks "Done" on the success screen so the applied state stays visible.
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Apply failed" });
    }
  }, [rejectedIds, onResolutionComplete]);

  /* ── Step 3: Reverse ────────────────────────────── */
  const handleReverse = useCallback(async (runId: string) => {
    setState({ step: "reversing" });

    try {
      const res = await fetch("/api/identity/resolve/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Reverse failed");
      }

      setState({ step: "idle" });
      onResolutionComplete();
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Reverse failed" });
    }
  }, [onResolutionComplete]);

  /* ── Toggle reject/accept for a candidate ────────── */
  const toggleReject = useCallback((candidateId: string) => {
    setRejectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }, []);

  /* ── Toggle expand a tier section ────────────────── */
  const toggleTier = useCallback((tier: number) => {
    setExpandedTier((prev) => (prev === tier ? null : tier));
  }, []);

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */

  /* ── Idle state: show run button ── */
  if (state.step === "idle") {
    return (
      <div className="explorer-resolve-banner">
        <span className="explorer-resolve-icon">🔗</span>
        <span className="explorer-resolve-label">Identity Resolution</span>
        <span className="explorer-resolve-desc">
          Match people across all sources and existing data
        </span>
        <span className="explorer-resolve-spacer" />
        <button className="explorer-resolve-btn" onClick={handleCompute}>
          Run Resolution
        </button>
      </div>
    );
  }

  /* ── Computing state ── */
  if (state.step === "computing") {
    return (
      <div className="explorer-resolve-banner">
        <span className="explorer-resolve-icon">⏳</span>
        <span className="explorer-resolve-label">Computing...</span>
        <span className="explorer-resolve-desc">
          Running waterfall matching across {multiSourceCount} sources
        </span>
      </div>
    );
  }

  /* ── Error state ── */
  if (state.step === "error") {
    return (
      <div className="explorer-resolve-banner" style={{ borderColor: "var(--color-red-200, #fecaca)", background: "var(--color-red-50, #fef2f2)" }}>
        <span className="explorer-resolve-icon">⚠️</span>
        <span className="explorer-resolve-label" style={{ color: "var(--color-red-700, #b91c1c)" }}>Error</span>
        <span className="explorer-resolve-desc" style={{ color: "var(--color-red-600, #dc2626)" }}>
          {state.message}
        </span>
        <span className="explorer-resolve-spacer" />
        <button className="explorer-resolve-btn" onClick={handleCompute}>
          Retry
        </button>
      </div>
    );
  }

  /* ── Applying/Reversing state ── */
  if (state.step === "applying" || state.step === "reversing") {
    return (
      <div className="explorer-resolve-banner">
        <span className="explorer-resolve-icon">⏳</span>
        <span className="explorer-resolve-label">
          {state.step === "applying" ? "Applying matches..." : "Reversing..."}
        </span>
        <span className="explorer-resolve-desc">
          {state.step === "applying" ? "Creating identity links" : "Undoing identity links"}
        </span>
      </div>
    );
  }

  /* ── Applied state: show success + undo ── */
  if (state.step === "applied") {
    return (
      <div className="explorer-resolve-banner" style={{ borderColor: "var(--color-green-200, #bbf7d0)", background: "var(--color-green-50, #f0fdf4)" }}>
        <span className="explorer-resolve-icon">✅</span>
        <span className="explorer-resolve-label" style={{ color: "var(--color-green-700, #15803d)" }}>
          Resolution Applied
        </span>
        <span className="explorer-resolve-desc" style={{ color: "var(--color-green-600, #16a34a)" }}>
          {state.edgesCreated} new links created
          {state.edgesExisting > 0 && `, ${state.edgesExisting} already existed`}
        </span>
        <span className="explorer-resolve-spacer" />
        <button
          className="ir-btn ir-btn-ghost"
          onClick={() => handleReverse(state.runId)}
        >
          Undo
        </button>
        <button
          className="ir-btn ir-btn-ghost"
          onClick={() => {
            onResolutionComplete(); // Reload data to show merged results
            setState({ step: "idle" });
          }}
        >
          Done
        </button>
      </div>
    );
  }

  /* ── Review state: full results panel ── */
  if (state.step === "review") {
    const { runId, byTier, candidates, totalScanned, durationMs } = state;
    const totalCandidates = byTier.reduce((s, t) => s + t.count, 0);
    const activeCount = totalCandidates - rejectedIds.size;

    return (
      <div className="ir-panel">
        {/* Header bar */}
        <div className="ir-header">
          <div className="ir-header-left">
            <span className="ir-header-icon">🔗</span>
            <div>
              <div className="ir-header-title">Identity Resolution Results</div>
              <div className="ir-header-meta">
                {totalScanned.toLocaleString()} records scanned in {formatDuration(durationMs)} &middot; {totalCandidates} matches found
              </div>
            </div>
          </div>
          <div className="ir-header-actions">
            <button
              className="ir-btn ir-btn-ghost"
              onClick={() => setState({ step: "idle" })}
            >
              Cancel
            </button>
            <button
              className="ir-btn ir-btn-primary"
              onClick={() => handleApply(runId, rejectedIds.size === 0)}
              disabled={activeCount === 0}
            >
              Apply {activeCount} Match{activeCount !== 1 ? "es" : ""}
            </button>
          </div>
        </div>

        {/* Tier sections */}
        <div className="ir-tiers">
          {byTier.map((tier) => {
            const isExpanded = expandedTier === tier.tier;
            const tierCandidates = candidates.filter((c) => c.match_tier === tier.tier);
            const conf = [0.99, 0.90, 0.80, 0.75, 0.70, 0.50][tier.tier - 1] || 0.5;

            return (
              <div key={tier.tier} className="ir-tier">
                <button className="ir-tier-header" onClick={() => toggleTier(tier.tier)}>
                  <div className="ir-tier-left">
                    <span
                      className="ir-confidence-dot"
                      style={{ backgroundColor: confidenceColor(conf) }}
                    />
                    <span className="ir-tier-label">{tier.label}</span>
                    <span className="ir-tier-count">{tier.count}</span>
                    {tier.needsReview > 0 && (
                      <span className="ir-needs-review">
                        {tier.needsReview} needs review
                      </span>
                    )}
                  </div>
                  <div className="ir-tier-right">
                    <span className="ir-confidence-badge" style={{ color: confidenceColor(conf) }}>
                      {confidenceLabel(conf)} ({Math.round(conf * 100)}%)
                    </span>
                    <span className="ir-tier-arrow">{isExpanded ? "▾" : "▸"}</span>
                  </div>
                </button>

                {isExpanded && tierCandidates.length > 0 && (
                  <div className="ir-candidates">
                    {tierCandidates.map((c) => {
                      const isRejected = rejectedIds.has(c.id);
                      const sourceAKey = SOURCE_KEYS[c.source_a_type] || "hubspot";
                      const sourceBKey = SOURCE_KEYS[c.source_b_type] || "shopify";
                      const colorA = SOURCE_COLORS[sourceAKey] || "#6b7280";
                      const colorB = SOURCE_COLORS[sourceBKey] || "#6b7280";

                      return (
                        <div
                          key={c.id}
                          className={`ir-candidate ${isRejected ? "ir-candidate-rejected" : ""}`}
                        >
                          <label className="ir-candidate-check">
                            <input
                              type="checkbox"
                              checked={!isRejected}
                              onChange={() => toggleReject(c.id)}
                            />
                          </label>
                          <div className="ir-candidate-records">
                            <span
                              className="ir-source-pill"
                              style={{ backgroundColor: colorA + "18", color: colorA, borderColor: colorA + "40" }}
                            >
                              {SOURCE_LABELS[c.source_a_type] || c.source_a_type}
                            </span>
                            <span className="ir-candidate-name">{c.source_a_label}</span>
                            <span className="ir-candidate-arrow">↔</span>
                            <span
                              className="ir-source-pill"
                              style={{ backgroundColor: colorB + "18", color: colorB, borderColor: colorB + "40" }}
                            >
                              {SOURCE_LABELS[c.source_b_type] || c.source_b_type}
                            </span>
                            <span className="ir-candidate-name">{c.source_b_label}</span>
                          </div>
                          <div className="ir-candidate-match">
                            <span className="ir-match-on">{c.matched_on}</span>
                            {c.needs_review && <span className="ir-flag">⚠️ Review</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {isExpanded && tierCandidates.length === 0 && (
                  <div className="ir-candidates-empty">
                    Expand to load candidate details. {tier.count} matches at this tier.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="ir-footer">
          <button
            className="ir-btn ir-btn-outline"
            onClick={() => {
              // Reject all low-confidence (tier 5-6) candidates
              if (state.step !== "review") return;
              const lowTierIds = candidates
                .filter((c) => c.match_tier >= 5)
                .map((c) => c.id);
              setRejectedIds(new Set(lowTierIds));
            }}
          >
            Reject Low Confidence
          </button>
          <button
            className="ir-btn ir-btn-outline"
            onClick={() => {
              // Accept all: clear rejections first
              setRejectedIds(new Set());
            }}
          >
            Clear Rejections
          </button>
          <button
            className="ir-btn ir-btn-primary"
            onClick={() => {
              // Accept All & Apply: clear rejections and immediately apply
              setRejectedIds(new Set());
              handleApply(runId, true);
            }}
          >
            Accept All &amp; Apply
          </button>
        </div>
      </div>
    );
  }

  return null;
}
