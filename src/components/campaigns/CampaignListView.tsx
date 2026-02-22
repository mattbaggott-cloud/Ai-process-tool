"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import CampaignReviewView from "./CampaignReviewView";
import CampaignStrategyView from "./CampaignStrategyView";
import type { EmailCampaign } from "@/lib/types/database";

/* ── Status badge mappings ──────────────────────────────── */
const statusBadgeClass: Record<string, string> = {
  draft: "campaign-badge-gray",
  generating: "campaign-badge-blue",
  review: "campaign-badge-yellow",
  approved: "campaign-badge-green",
  sending: "campaign-badge-blue",
  sent: "campaign-badge-green",
  paused: "campaign-badge-amber",
  cancelled: "campaign-badge-red",
  failed: "campaign-badge-red",
  strategy_review: "campaign-badge-yellow",
};

const typeBadgeClass: Record<string, string> = {
  per_customer: "campaign-badge-purple",
  broadcast: "campaign-badge-blue",
  sequence: "campaign-badge-teal",
};

/* ── Helpers ────────────────────────────────────────────── */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/* ── Component ──────────────────────────────────────────── */
type ViewMode = "list" | "review" | "strategy";

export default function CampaignListView() {
  const { user } = useAuth();
  const { orgId } = useOrg();

  const [view, setView] = useState<ViewMode>("list");
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);

  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendConfirmId, setSendConfirmId] = useState<string | null>(null);

  /* ── Send campaign from list ─────────────────────────── */
  const handleListSend = async (e: React.MouseEvent, campaignId: string) => {
    e.stopPropagation();
    setSendConfirmId(campaignId);
  };

  const confirmListSend = async () => {
    if (!sendConfirmId) return;
    setSendingId(sendConfirmId);
    setSendConfirmId(null);
    try {
      const res = await fetch(`/api/campaigns/${sendConfirmId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("Send failed:", err.error);
      }
      await loadCampaigns();
    } catch {
      /* silent */
    } finally {
      setSendingId(null);
    }
  };

  /* ── Pause / Cancel from list ──────────────────────────── */
  const handleListAction = async (
    e: React.MouseEvent,
    campaignId: string,
    action: "pause" | "cancel"
  ) => {
    e.stopPropagation();
    try {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      loadCampaigns();
    } catch { /* silent */ }
  };

  const handleListResume = async (
    e: React.MouseEvent,
    campaignId: string
  ) => {
    e.stopPropagation();
    try {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      fetch(`/api/campaigns/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      loadCampaigns();
    } catch { /* silent */ }
  };

  /* ── Fetch campaigns ──────────────────────────────────── */
  const loadCampaigns = useCallback(async () => {
    if (!user || !orgId) return;
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("email_campaigns")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data } = await query;
    setCampaigns((data as EmailCampaign[]) ?? []);
    setLoading(false);
  }, [user, orgId, statusFilter]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  /* ── Filter campaigns by search ────────────────────────── */
  const filtered = campaigns.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email_type || "").toLowerCase().includes(q) ||
      (c.delivery_channel || "").toLowerCase().includes(q)
    );
  });

  /* ── Summary stats ─────────────────────────────────────── */
  const stats = {
    total: campaigns.length,
    review: campaigns.filter((c) => c.status === "review").length,
    sent: campaigns.filter((c) => c.status === "sent").length,
    generating: campaigns.filter((c) => c.status === "generating").length,
  };

  /* ── Auto-refresh when campaigns are generating ─────── */
  useEffect(() => {
    if (stats.generating === 0) return;
    const interval = setInterval(loadCampaigns, 5000);
    return () => clearInterval(interval);
  }, [stats.generating, loadCampaigns]);

  /* ── Open campaign view ──────────────────────────────────── */
  const openCampaign = (campaign: EmailCampaign) => {
    setActiveCampaignId(campaign.id);
    setView("strategy");
  };

  /* ── Strategy view ──────────────────────────────────────── */
  if (view === "strategy" && activeCampaignId) {
    return (
      <CampaignStrategyView
        campaignId={activeCampaignId}
        onBack={() => {
          setView("list");
          setActiveCampaignId(null);
          loadCampaigns();
        }}
      />
    );
  }

  /* ── Review view ───────────────────────────────────────── */
  if (view === "review" && activeCampaignId) {
    return (
      <CampaignReviewView
        campaignId={activeCampaignId}
        onBack={() => {
          setView("list");
          setActiveCampaignId(null);
          loadCampaigns();
        }}
      />
    );
  }

  /* ── Render a campaign card ─────────────────────────────── */
  const renderCampaignCard = (c: EmailCampaign) => {
    const isGenerating = c.status === "generating";
    const isPaused = c.status === "paused";
    const isCancelled = c.status === "cancelled";
    const isFailed = c.status === "failed";
    const isActive = isGenerating || isPaused || isCancelled || isFailed;

    return (
      <div
        key={c.id}
        className={`cl-card ${isActive ? "cl-card-active" : ""} ${isFailed ? "cl-card-failed" : ""}`}
        onClick={() => openCampaign(c)}
      >
        {/* Top row: name + meta */}
        <div className="cl-card-header">
          <div className="cl-card-title-area">
            <span className="cl-card-name">{c.name}</span>
            <div className="cl-card-meta">
              <span className={`campaign-badge ${typeBadgeClass[c.campaign_type] || "campaign-badge-gray"}`}>
                {capitalise(c.campaign_type)}
              </span>
              <span className={`campaign-badge ${statusBadgeClass[c.status] || "campaign-badge-gray"}`}>
                {capitalise(c.status)}
              </span>
              {c.email_type && (
                <span className="cl-card-email-type">{capitalise(c.email_type)}</span>
              )}
            </div>
          </div>
          <div className="cl-card-right">
            {/* Send button — inline for approved campaigns */}
            {(c.status === "approved" || c.status === "review") && (c.approved_count ?? 0) > 0 && (
              <button
                className="cl-send-btn"
                disabled={sendingId === c.id}
                onClick={(e) => handleListSend(e, c.id)}
              >
                {sendingId === c.id ? (
                  <>
                    <div className="cl-send-spinner" />
                    Sending...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Send ({c.approved_count})
                  </>
                )}
              </button>
            )}
            {c.status === "sent" && (
              <span className="cl-sent-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Sent
              </span>
            )}
            <span className="cl-card-date">{formatDate(c.created_at)}</span>
            <span className="cl-card-variants">
              {isActive ? (
                <>{c.total_variants} emails generated</>
              ) : (
                <>
                  {c.approved_count}/{c.total_variants} variants
                  {c.sent_count > 0 && <span className="cl-card-sent"> ({c.sent_count} sent)</span>}
                </>
              )}
            </span>
          </div>
        </div>

        {/* Generating/paused/cancelled actions */}
        {isActive && (
          <div className="cl-card-progress-area">
            {/* Action buttons */}
            <div className="cl-progress-actions">
              {isGenerating && (
                <>
                  <button
                    className="cl-action-btn cl-action-pause"
                    onClick={(e) => handleListAction(e, c.id, "pause")}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <rect x="1" y="0.5" width="3.5" height="11" rx="1" />
                      <rect x="7.5" y="0.5" width="3.5" height="11" rx="1" />
                    </svg>
                    Pause
                  </button>
                  <button
                    className="cl-action-btn cl-action-cancel"
                    onClick={(e) => handleListAction(e, c.id, "cancel")}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
                    </svg>
                    Cancel
                  </button>
                </>
              )}
              {isPaused && (
                <>
                  <button
                    className="cl-action-btn cl-action-resume"
                    onClick={(e) => handleListResume(e, c.id)}
                  >
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                      <path d="M0 1.5C0 .83.837.434 1.374.81L9.2 5.31c.467.327.467 1.053 0 1.38L1.374 11.19C.837 11.566 0 11.17 0 10.5V1.5z" />
                    </svg>
                    Resume
                  </button>
                  <button
                    className="cl-action-btn cl-action-cancel"
                    onClick={(e) => handleListAction(e, c.id, "cancel")}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
                    </svg>
                    Cancel
                  </button>
                </>
              )}
              {isCancelled && (
                <button
                  className="cl-action-btn cl-action-resume"
                  onClick={(e) => handleListResume(e, c.id)}
                >
                  <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                    <path d="M0 1.5C0 .83.837.434 1.374.81L9.2 5.31c.467.327.467 1.053 0 1.38L1.374 11.19C.837 11.566 0 11.17 0 10.5V1.5z" />
                  </svg>
                  Resume
                </button>
              )}
              {isFailed && (
                <button
                  className="cl-action-btn cl-action-resume"
                  onClick={(e) => handleListResume(e, c.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1v4h4" />
                    <path d="M1 5a5 5 0 1 1 1.5 3.5" />
                  </svg>
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ── List view ─────────────────────────────────────────── */
  return (
    <div className="campaign-page">
      {/* Header */}
      <div className="campaign-page-header">
        <h1 className="campaign-page-title">Campaigns</h1>
        <p className="campaign-page-subtitle">
          Review and manage AI-generated email campaigns
        </p>
      </div>

      {/* Stats bar */}
      <div className="campaign-metrics-bar">
        <div className="campaign-metric-card">
          <div className="campaign-metric-value">{stats.total}</div>
          <div className="campaign-metric-label">Total</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-yellow">
            {stats.review}
          </div>
          <div className="campaign-metric-label">Needs Review</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-blue">
            {stats.generating}
          </div>
          <div className="campaign-metric-label">Generating</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-green">
            {stats.sent}
          </div>
          <div className="campaign-metric-label">Sent</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="campaign-toolbar">
        <input
          type="text"
          className="campaign-search-input"
          placeholder="Search campaigns..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="campaign-filter-pills">
          {["all", "draft", "generating", "review", "approved", "sending", "sent", "failed"].map(
            (s) => (
              <button
                key={s}
                className={`campaign-filter-pill ${statusFilter === s ? "campaign-filter-pill-active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {capitalise(s)}
              </button>
            )
          )}
        </div>
      </div>

      {/* Campaign cards */}
      {loading ? (
        <div className="crm-loading">Loading campaigns...</div>
      ) : filtered.length === 0 ? (
        <div className="campaign-empty">
          <div className="campaign-empty-icon">
            <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M24 8 6 18v20l18 10 18-10V18L24 8Z" />
              <path d="M6 18l18 10 18-10M24 28v20" />
            </svg>
          </div>
          <h3>No campaigns yet</h3>
          <p>
            Use the AI chat to generate your first campaign. Try: &quot;Create a
            win-back campaign for churning customers&quot;
          </p>
        </div>
      ) : (
        <div className="cl-card-list">
          {filtered.map(renderCampaignCard)}
        </div>
      )}

      {/* Send Confirmation Modal */}
      {sendConfirmId && (() => {
        const camp = campaigns.find((c) => c.id === sendConfirmId);
        return (
          <div className="sv-modal-overlay" onClick={() => setSendConfirmId(null)}>
            <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sv-modal-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
              <h3 className="sv-modal-title">Send Campaign</h3>
              <p className="sv-modal-text">
                Send <strong>{camp?.name}</strong> to {camp?.approved_count ?? 0} recipients? This action cannot be undone.
              </p>
              <div className="sv-modal-actions">
                <button className="sv-btn sv-btn-secondary" onClick={() => setSendConfirmId(null)}>
                  Cancel
                </button>
                <button className="cl-send-btn" onClick={confirmListSend}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Send Now
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
