"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import CampaignBuilderView from "./CampaignBuilderView";
import type { EmailCampaign, CampaignCategory } from "@/lib/types/database";

import { STATUS_BADGE_CLASS, CHANNEL_META, capitalise } from "./campaign-constants";

const statusBadgeClass = STATUS_BADGE_CLASS;

/* ── Helpers ──────────────────────────────────────────────── */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ── Category tabs ────────────────────────────────────────── */
type CategoryTab = "all" | CampaignCategory;

/* ── Sortable columns ─────────────────────────────────────── */
type SortKey = "name" | "status" | "created_at";

/* ── Component ────────────────────────────────────────────── */
export default function CampaignListView() {
  const { user } = useAuth();
  const { orgId } = useOrg();

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  // Builder view
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);

  // Send actions
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendConfirmId, setSendConfirmId] = useState<string | null>(null);

  /* ── Send campaign ──────────────────────────────────────── */
  const handleListSend = (e: React.MouseEvent, campaignId: string) => {
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

  /* ── Fetch campaigns ────────────────────────────────────── */
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

  /* ── Auto-refresh when generating ───────────────────────── */
  const generatingCount = campaigns.filter((c) => c.status === "generating").length;
  useEffect(() => {
    if (generatingCount === 0) return;
    const interval = setInterval(loadCampaigns, 5000);
    return () => clearInterval(interval);
  }, [generatingCount, loadCampaigns]);

  /* ── Filter + sort ──────────────────────────────────────── */
  const filtered = campaigns
    .filter((c) => {
      // Category tab
      if (categoryTab !== "all" && c.campaign_category !== categoryTab) return false;
      // Search
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.email_type || "").toLowerCase().includes(q) &&
          !(c.delivery_channel || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortAsc ? cmp : -cmp;
    });

  /* ── Stats ──────────────────────────────────────────────── */
  const stats = {
    total: campaigns.length,
    active: campaigns.filter((c) => ["generating", "sending", "approved", "review"].includes(c.status)).length,
    draft: campaigns.filter((c) => c.status === "draft").length,
    sent: campaigns.filter((c) => c.status === "sent").length,
  };

  /* ── Sort handler ───────────────────────────────────────── */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortAsc ? " \u25B2" : " \u25BC";
  };

  /* ── Builder view ───────────────────────────────────────── */
  if (activeCampaignId) {
    return (
      <CampaignBuilderView
        campaignId={activeCampaignId}
        onBack={() => {
          setActiveCampaignId(null);
          loadCampaigns();
        }}
      />
    );
  }

  /* ── List view (sortable table) ─────────────────────────── */
  return (
    <div className="campaign-page">
      {/* Header */}
      <div className="campaign-page-header">
        <div className="campaign-page-header-left">
          <h1 className="campaign-page-title">Campaigns</h1>
          <p className="campaign-page-subtitle">
            Build, manage and send AI-powered campaigns
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Campaigns</div>
        </div>
        <div className="stat-box">
          <div className="stat-value stat-value-blue">{stats.active}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-box">
          <div className="stat-value stat-value-muted">{stats.draft}</div>
          <div className="stat-label">Draft</div>
        </div>
        <div className="stat-box">
          <div className="stat-value stat-value-green">{stats.sent}</div>
          <div className="stat-label">Sent</div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="data-tabs">
        {(["all", "sales", "marketing"] as CategoryTab[]).map((tab) => (
          <button
            key={tab}
            className={`data-tab ${categoryTab === tab ? "data-tab-active" : ""}`}
            onClick={() => setCategoryTab(tab)}
          >
            {tab === "all" ? "All" : capitalise(tab)}
            <span className="tab-count">
              ({tab === "all"
                ? campaigns.length
                : campaigns.filter((c) => c.campaign_category === tab).length})
            </span>
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="campaign-toolbar">
        <input
          type="text"
          className="campaign-search-input"
          placeholder="Search campaigns..."
          aria-label="Search campaigns"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="campaign-filter-pills">
          {["all", "draft", "generating", "review", "approved", "sent", "failed"].map((s) => (
            <button
              key={s}
              className={`campaign-filter-pill ${statusFilter === s ? "campaign-filter-pill-active" : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {capitalise(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign table */}
      {loading ? (
        <div className="crm-loading">Loading campaigns...</div>
      ) : filtered.length === 0 ? (
        <div className="campaign-empty">
          <div className="campaign-empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M24 8 6 18v20l18 10 18-10V18L24 8Z" />
              <path d="M6 18l18 10 18-10M24 28v20" />
            </svg>
          </div>
          <h3>No campaigns yet</h3>
          <p>
            Use the AI chat to create your first campaign. Try: &quot;Create a
            win-back campaign for churning customers&quot;
          </p>
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th className="sortable col-name" onClick={() => handleSort("name")}>
                  Name{sortArrow("name")}
                </th>
                <th>Category</th>
                <th className="sortable" onClick={() => handleSort("status")}>
                  Status{sortArrow("status")}
                </th>
                <th>Channel</th>
                <th>Variants</th>
                <th className="sortable" onClick={() => handleSort("created_at")}>
                  Created{sortArrow("created_at")}
                </th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const channel = c.delivery_channel ? CHANNEL_META[c.delivery_channel] : null;
                return (
                  <tr
                    key={c.id}
                    className="crm-table-row crm-table-row-clickable"
                    onClick={() => setActiveCampaignId(c.id)}
                  >
                    <td className="crm-cell-name">{c.name}</td>
                    <td>
                      <span className={`campaign-badge ${
                        c.campaign_category === "sales" ? "campaign-badge-purple" : "campaign-badge-blue"
                      }`}>
                        {capitalise(c.campaign_category ?? "marketing")}
                      </span>
                    </td>
                    <td>
                      <span className={`campaign-badge ${statusBadgeClass[c.status] || "campaign-badge-gray"}`}>
                        {capitalise(c.status)}
                      </span>
                    </td>
                    <td>
                      {channel ? (
                        <span
                          className="cb-channel-dot"
                          style={{ background: channel.color }}
                          title={c.delivery_channel}
                        >
                          {channel.label}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {c.total_variants > 0 ? (
                        <span>
                          {c.approved_count}/{c.total_variants}
                          {c.sent_count > 0 && (
                            <span className="text-success tab-count">({c.sent_count} sent)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>{formatDate(c.created_at)}</td>
                    <td>
                      {(c.status === "approved" || c.status === "review") && (c.approved_count ?? 0) > 0 && (
                        <button
                          className="btn btn-xs btn-primary"
                          disabled={sendingId === c.id}
                          onClick={(e) => handleListSend(e, c.id)}
                        >
                          {sendingId === c.id ? "\u2026" : `Send (${c.approved_count})`}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
