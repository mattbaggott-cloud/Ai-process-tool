"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import StrategyGroupCard from "./StrategyGroupCard";
import CampaignReviewView from "./CampaignReviewView";
import type { CampaignStrategyGroup } from "@/lib/types/database";

/* ── Types ── */

interface VariantCounts {
  total: number;
  approved: number;
  sent: number;
}

interface StrategyGroupWithCounts extends CampaignStrategyGroup {
  variant_counts?: VariantCounts;
}

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  has_strategy: boolean;
  delivery_channel: string | null;
  total_variants: number;
  approved_count: number;
  sent_count: number;
  stats: Record<string, number> | null;
  email_type?: string | null;
  campaign_type?: string | null;
  segment_id?: string | null;
  prompt_used?: string | null;
}

interface StrategyResponse {
  campaign: CampaignSummary;
  groups: StrategyGroupWithCounts[];
}

/* ── Props ── */

interface CampaignStrategyViewProps {
  campaignId: string;
  onBack: () => void;
}

/* ── Helpers ── */

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/* ── Component ── */

export default function CampaignStrategyView({
  campaignId,
  onBack,
}: CampaignStrategyViewProps) {
  const { user } = useAuth();
  const { orgId } = useOrg();

  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [groups, setGroups] = useState<StrategyGroupWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sub-view for reviewing emails of a specific group
  const [reviewGroupId, setReviewGroupId] = useState<string | null>(null);

  // Track which group's members are being viewed (inline)
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null);

  // Send state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendMode, setSendMode] = useState<"all" | string>("all"); // "all" or a group ID
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendDropdownOpen, setSendDropdownOpen] = useState(false);

  // For non-strategy campaigns: segment name + customer count
  const [segmentInfo, setSegmentInfo] = useState<{ name: string; customerCount: number } | null>(null);

  /* ── Load strategy data ── */
  const loadStrategy = useCallback(async () => {
    if (!user || !orgId) return;

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/strategy`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load strategy");
        setLoading(false);
        return;
      }

      const data: StrategyResponse = await res.json();
      setCampaign(data.campaign);
      setGroups(data.groups);
      setGenerating(data.campaign.status === "generating");

      // For non-strategy campaigns, load audience info for display
      if (data.groups.length === 0) {
        try {
          const supabase = createClient();
          let audienceName = data.campaign.name;
          let customerCount = data.campaign.total_variants;

          // If campaign has a segment, use segment info
          if (data.campaign.segment_id) {
            const { data: seg } = await supabase
              .from("segments")
              .select("name")
              .eq("id", data.campaign.segment_id)
              .single();
            const { count } = await supabase
              .from("segment_members")
              .select("id", { count: "exact", head: true })
              .eq("segment_id", data.campaign.segment_id)
              .eq("org_id", orgId);
            audienceName = seg?.name ?? audienceName;
            customerCount = count ?? customerCount;
          }

          // If still 0, count distinct customers from generated variants
          if (customerCount === 0 && data.campaign.total_variants > 0) {
            customerCount = data.campaign.total_variants;
          }

          setSegmentInfo({
            name: audienceName,
            customerCount,
          });
        } catch {
          setSegmentInfo(null);
        }
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setLoading(false);
    }
  }, [user, orgId, campaignId]);

  useEffect(() => {
    loadStrategy();
  }, [loadStrategy]);

  /* ── Auto-refresh while generating ── */
  useEffect(() => {
    if (!generating) return;
    const interval = setInterval(loadStrategy, 3000);
    return () => clearInterval(interval);
  }, [generating, loadStrategy]);

  /* ── Group actions ── */
  const handleGroupAction = async (
    groupId: string,
    action: "approve" | "reject"
  ) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/strategy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, action }),
      });
      if (res.ok) {
        loadStrategy();
      }
    } catch {
      // silent
    }
  };

  /* ── Generate emails for a single group ── */
  const handleGenerateGroup = async (groupId: string) => {
    if (!campaign) return;
    setGenerating(true);

    try {
      // Approve the group first if it's in draft
      const group = groups.find((g) => g.id === groupId);
      if (group?.status === "draft") {
        await fetch(`/api/campaigns/${campaignId}/strategy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, action: "approve" }),
        });
      }

      // Trigger generation — the engine handles per-group logic
      await fetch(`/api/campaigns/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });

      // Start auto-refresh
      loadStrategy();
    } catch {
      setGenerating(false);
    }
  };

  /* ── Generate all emails ── */
  const handleGenerateAll = async () => {
    if (!campaign) return;
    setGenerating(true);

    try {
      // Approve all draft groups first
      for (const group of groups) {
        if (group.status === "draft") {
          await fetch(`/api/campaigns/${campaignId}/strategy`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: group.id, action: "approve" }),
          });
        }
      }

      // Trigger generation via the campaign generate endpoint
      await fetch(`/api/campaigns/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });

      // Start auto-refresh
      loadStrategy();
    } catch {
      setGenerating(false);
    }
  };

  /* ── Delete campaign ── */
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onBack(); // Return to list
      } else {
        const err = await res.json();
        setError(err.error || "Failed to delete campaign");
        setShowDeleteConfirm(false);
      }
    } catch {
      setError("Failed to delete campaign");
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  /* ── Send campaign ── */
  const handleSendCampaign = async () => {
    setSendingCampaign(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? 0 });
        await loadStrategy();
      } else {
        const err = await res.json();
        setError(err.error || "Failed to send campaign");
        setShowSendConfirm(false);
      }
    } catch {
      setError("Failed to send campaign");
      setShowSendConfirm(false);
    } finally {
      setSendingCampaign(false);
    }
  };

  /* ── Pause generation ── */
  const handlePause = async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      if (res.ok) {
        setGenerating(false);
        loadStrategy();
      }
    } catch { /* silent */ }
  };

  /* ── Cancel generation ── */
  const handleCancel = async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        setGenerating(false);
        loadStrategy();
      }
    } catch { /* silent */ }
  };

  /* ── Resume generation ── */
  const handleResume = async () => {
    try {
      // Set status back to generating
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (!res.ok) return;

      setGenerating(true);

      // Re-trigger the generate endpoint — it will skip already-generated variants
      await fetch(`/api/campaigns/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });

      loadStrategy();
    } catch {
      setGenerating(false);
    }
  };

  /* ── Stats ── */
  const totalCustomers = groups.reduce((s, g) => s + g.customer_count, 0);
  const totalSteps = groups.reduce(
    (s, g) =>
      s + (Array.isArray(g.sequence_steps) ? g.sequence_steps.length : 0),
    0
  );
  // Compute expected total from customer_count × steps (more reliable than total_emails
  // which can be stale if overwritten by a PATCH call)
  const totalEmails = groups.reduce(
    (s, g) => s + g.customer_count * Math.max(Array.isArray(g.sequence_steps) ? g.sequence_steps.length : 1, 1),
    0
  );
  const maxDays = Math.max(
    ...groups.map((g) => {
      const steps = Array.isArray(g.sequence_steps) ? g.sequence_steps : [];
      return steps.length > 0
        ? Math.max(...steps.map((s) => s.delay_days))
        : 0;
    }),
    0
  );

  // Total generated variants (used for "Review All" button + banners)
  // For non-strategy campaigns, groups is empty — fall back to campaign.total_variants
  const totalGeneratedVariants = groups.length > 0
    ? groups.reduce((s, g) => s + (g.variant_counts?.total ?? 0), 0)
    : (campaign?.total_variants ?? 0);
  const expectedTotalVariants = totalEmails;

  /* ── If reviewing emails for a specific group, show review view ── */
  if (reviewGroupId) {
    return (
      <CampaignReviewView
        campaignId={campaignId}
        onBack={() => {
          setReviewGroupId(null);
          loadStrategy();
        }}
      />
    );
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="sv-loading">
        <div className="sv-loading-spinner" />
        Loading campaign strategy...
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="sv-page">
        <div className="sv-header">
          <div className="sv-header-left">
            <button className="sv-back-btn" onClick={onBack}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12L6 8l4-4" />
              </svg>
              Back
            </button>
          </div>
        </div>
        <div className="sv-error">
          <div className="sv-error-title">Something went wrong</div>
          <div className="sv-error-msg">{error}</div>
          <button className="sv-btn sv-btn-secondary" onClick={loadStrategy}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  /* ── Status badge helper ── */
  const statusClass = campaign ? `sv-status-${campaign.status}` : "sv-status-draft";

  /* ── Main view ── */
  return (
    <div className="sv-page">
      {/* ── Sticky Header ── */}
      <div className="sv-header">
        <div className="sv-header-left">
          <button className="sv-back-btn" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Back
          </button>
          <div className="sv-header-info">
            <h1 className="sv-title">{campaign?.name}</h1>
            <div className="sv-subtitle">
              {campaign?.has_strategy ? "Campaign Strategy" : "Campaign Overview"}
              {campaign?.delivery_channel && (
                <span className="sv-channel-tag">
                  {capitalise(campaign.delivery_channel)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="sv-header-right">
          {campaign && (
            <>
              <span className={`sv-status-badge ${statusClass}`}>
                <span className="sv-status-dot" />
                {capitalise(campaign.status)}
              </span>

              {/* Send Campaign button + dropdown */}
              {(campaign.status === "approved" || campaign.status === "review") &&
                (campaign.approved_count ?? 0) > 0 && (
                <div className="sv-send-wrapper">
                  <button
                    className="sv-send-btn"
                    onClick={() => {
                      setSendMode("all");
                      setShowSendConfirm(true);
                      setSendDropdownOpen(false);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Send Campaign
                  </button>
                  {groups.length > 1 && (
                    <>
                      <button
                        className="sv-send-dropdown-toggle"
                        onClick={() => setSendDropdownOpen(!sendDropdownOpen)}
                        title="Send options"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M3 5l3 3 3-3" />
                        </svg>
                      </button>
                      {sendDropdownOpen && (
                        <>
                          <div
                            className="sv-send-dropdown-backdrop"
                            onClick={() => setSendDropdownOpen(false)}
                          />
                          <div className="sv-send-dropdown">
                            <button
                              className="sv-send-dropdown-item"
                              onClick={() => {
                                setSendMode("all");
                                setShowSendConfirm(true);
                                setSendDropdownOpen(false);
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <line x1="22" y1="2" x2="11" y2="13" />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                              </svg>
                              Send Entire Campaign ({campaign.approved_count} emails)
                            </button>
                            <div className="sv-send-dropdown-divider" />
                            <div className="sv-send-dropdown-label">Send by Group</div>
                            {groups.filter((g) => (g.variant_counts?.approved ?? 0) > 0).map((g) => (
                              <button
                                key={g.id}
                                className="sv-send-dropdown-item"
                                onClick={() => {
                                  setSendMode(g.id);
                                  setShowSendConfirm(true);
                                  setSendDropdownOpen(false);
                                }}
                              >
                                {g.group_name} ({g.variant_counts?.approved ?? 0} emails)
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {campaign.status === "sent" && (
                <span className="sv-sent-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Sent
                </span>
              )}

              {campaign.status !== "sending" && campaign.status !== "sent" && (
                <button
                  className="sv-delete-btn"
                  onClick={() => setShowDeleteConfirm(true)}
                  title="Delete campaign"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4M12.667 4v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div className="sv-modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sv-modal-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 className="sv-modal-title">Delete Campaign</h3>
            <p className="sv-modal-text">
              Are you sure you want to delete <strong>{campaign?.name}</strong>? This will permanently remove all strategy groups, generated emails, and associated data. This action cannot be undone.
            </p>
            <div className="sv-modal-actions">
              <button
                className="sv-btn sv-btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="sv-btn sv-btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send Confirmation Modal ── */}
      {showSendConfirm && (
        <div className="sv-modal-overlay" onClick={() => !sendingCampaign && setShowSendConfirm(false)}>
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sv-modal-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
            {sendResult ? (
              <>
                <h3 className="sv-modal-title">Campaign Sent!</h3>
                <p className="sv-modal-text">
                  Successfully sent <strong>{sendResult.sent}</strong> emails.
                  {sendResult.failed > 0 && <> ({sendResult.failed} failed)</>}
                </p>
                <div className="sv-modal-actions">
                  <button
                    className="sv-btn sv-btn-primary"
                    onClick={() => { setShowSendConfirm(false); setSendResult(null); }}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="sv-modal-title">Send Campaign</h3>
                <p className="sv-modal-text">
                  {sendMode === "all" ? (
                    <>Send <strong>{campaign?.name}</strong> to <strong>{campaign?.approved_count ?? 0}</strong> recipients? This action cannot be undone.</>
                  ) : (
                    <>Send <strong>{groups.find((g) => g.id === sendMode)?.group_name}</strong> group ({groups.find((g) => g.id === sendMode)?.variant_counts?.approved ?? 0} emails)? This action cannot be undone.</>
                  )}
                </p>
                <div className="sv-modal-actions">
                  <button
                    className="sv-btn sv-btn-secondary"
                    onClick={() => setShowSendConfirm(false)}
                    disabled={sendingCampaign}
                  >
                    Cancel
                  </button>
                  <button
                    className="sv-send-btn"
                    onClick={handleSendCampaign}
                    disabled={sendingCampaign}
                  >
                    {sendingCampaign ? (
                      <>
                        <div className="cl-send-spinner" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        Send Now
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Metrics Row ── */}
      <div className="sv-metrics">
        {groups.length > 0 ? (
          <>
            <div className="sv-metric">
              <div className="sv-metric-value">{groups.length}</div>
              <div className="sv-metric-label">Groups</div>
            </div>
            <div className="sv-metric">
              <div className="sv-metric-value">
                {totalCustomers.toLocaleString()}
              </div>
              <div className="sv-metric-label">Customers</div>
            </div>
            <div className="sv-metric">
              <div className="sv-metric-value">{totalSteps}</div>
              <div className="sv-metric-label">Total Emails</div>
            </div>
            <div className="sv-metric">
              <div className="sv-metric-value">
                {maxDays > 0 ? `${maxDays}d` : "—"}
              </div>
              <div className="sv-metric-label">Cadence</div>
            </div>
          </>
        ) : (
          <>
            <div className="sv-metric">
              <div className="sv-metric-value">{campaign?.total_variants ?? 0}</div>
              <div className="sv-metric-label">Emails</div>
            </div>
            <div className="sv-metric">
              <div className="sv-metric-value">{campaign?.approved_count ?? 0}</div>
              <div className="sv-metric-label">Approved</div>
            </div>
            <div className="sv-metric">
              <div className="sv-metric-value">{campaign?.sent_count ?? 0}</div>
              <div className="sv-metric-label">Sent</div>
            </div>
          </>
        )}
      </div>

      {/* ── Content ── */}
      <div className="sv-content">
        {/* ── Generation action bar (no redundant overall bar — per-group bars are authoritative) ── */}
        {generating && (
          <div className="sv-gen-banner">
            <div className="sv-gen-banner-left">
              <div className="sv-gen-spinner" />
              <span className="sv-gen-banner-text">Generating emails...</span>
            </div>
            <div className="sv-gen-banner-actions">
              <button className="sv-btn sv-btn-pause sv-btn-sm" onClick={handlePause}>
                Pause
              </button>
              <button className="sv-btn sv-btn-cancel sv-btn-sm" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {campaign?.status === "paused" && (
          <div className="sv-paused-banner">
            <div className="sv-banner-text">
              Generation paused. {totalGeneratedVariants > 0
                ? `${totalGeneratedVariants} of ${expectedTotalVariants} emails generated so far.`
                : "No emails generated yet."}
            </div>
            <div className="sv-banner-actions">
              <button className="sv-btn sv-btn-primary sv-btn-sm" onClick={handleResume}>
                Resume
              </button>
              <button className="sv-btn sv-btn-cancel sv-btn-sm" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {campaign?.status === "cancelled" && (
          <div className="sv-cancelled-banner">
            <div className="sv-banner-text">
              Generation cancelled. {totalGeneratedVariants > 0
                ? `${totalGeneratedVariants} emails were generated before cancellation.`
                : "No emails were generated."}
            </div>
            <button className="sv-btn sv-btn-secondary sv-btn-sm" onClick={handleResume}>
              Resume Generation
            </button>
          </div>
        )}

        {campaign?.status === "failed" && (
          <div className="sv-failed-banner">
            <div className="sv-banner-text">
              Generation failed. {totalGeneratedVariants > 0
                ? `${totalGeneratedVariants} emails were generated before the error.`
                : "No emails were generated."}
            </div>
            <button className="sv-btn sv-btn-primary sv-btn-sm" onClick={handleResume}>
              Retry Generation
            </button>
          </div>
        )}

        {groups.length > 0 ? (
          <>
            {/* ── Section Label ── */}
            <div className="sv-section-label">
              {groups.length === 1 ? "Campaign Audience" : `Strategy Groups (${groups.length})`}
            </div>

            {/* ── Group cards ── */}
            {groups.map((group) => (
              <StrategyGroupCard
                key={group.id}
                group={group}
                isGenerating={generating}
                showMembers={memberGroupId === group.id}
                campaignId={campaignId}
                initialExpanded={groups.length === 1}
                onApprove={(id) => handleGroupAction(id, "approve")}
                onReject={(id) => handleGroupAction(id, "reject")}
                onViewEmails={(id) => setReviewGroupId(id)}
                onViewMembers={(id) =>
                  setMemberGroupId((prev) => (prev === id ? null : id))
                }
                onGenerate={(id) => handleGenerateGroup(id)}
              />
            ))}
          </>
        ) : (
          /* ── Non-strategy campaign — build a synthetic group with full functionality ── */
          <>
            <div className="sv-section-label">Campaign Audience</div>
            {(() => {
              const audienceName = segmentInfo?.name ?? campaign?.name ?? "All Customers";
              const custCount = segmentInfo?.customerCount ?? campaign?.total_variants ?? 0;
              const emailType = campaign?.email_type ?? "promotional";

              const syntheticGroup: StrategyGroupWithCounts = {
                id: "synthetic",
                org_id: orgId ?? "",
                campaign_id: campaignId,
                group_name: audienceName,
                group_description: null,
                ai_reasoning: campaign?.prompt_used ?? null,
                filter_criteria: {},
                customer_ids: [],
                customer_count: custCount,
                sequence_steps: [{
                  step_number: 1,
                  delay_days: 0,
                  email_type: emailType,
                  prompt: campaign?.prompt_used ?? "",
                }],
                total_emails: custCount,
                sort_order: 0,
                status: campaign?.status ?? "draft",
                created_at: "",
                updated_at: "",
                variant_counts: {
                  total: campaign?.total_variants ?? 0,
                  approved: campaign?.approved_count ?? 0,
                  sent: campaign?.sent_count ?? 0,
                },
              };

              return (
                <StrategyGroupCard
                  group={syntheticGroup}
                  isGenerating={generating}
                  showMembers={memberGroupId === "synthetic"}
                  campaignId={campaignId}
                  initialExpanded
                  onViewEmails={() => setReviewGroupId("all")}
                  onViewMembers={() =>
                    setMemberGroupId((prev) => (prev === "synthetic" ? null : "synthetic"))
                  }
                  onGenerate={() => handleGenerateAll()}
                />
              );
            })()}
          </>
        )}
      </div>

      {/* ── Bottom actions ── */}
      <div className="sv-bottom-actions">
        {/* Generate All — only shown when multiple groups exist and none have started */}
        {campaign?.status !== "generating" &&
          campaign?.status !== "sent" &&
          totalGeneratedVariants === 0 &&
          groups.length > 1 && (
            <button
              className="sv-btn sv-btn-secondary sv-btn-lg"
              onClick={handleGenerateAll}
              disabled={generating}
            >
              {generating ? (
                <>
                  <div className="sv-loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Generating...
                </>
              ) : (
                <>Generate All Groups ({totalEmails} emails)</>
              )}
            </button>
          )}

        {/* Review emails — shown for both strategy and non-strategy campaigns */}
        {((totalGeneratedVariants > 0 && !generating) ||
          (groups.length === 0 && (campaign?.total_variants ?? 0) > 0)) && (
          <button
            className="sv-btn sv-btn-primary sv-btn-lg"
            onClick={() => setReviewGroupId("all")}
          >
            Review All Emails ({totalGeneratedVariants || campaign?.total_variants || 0})
          </button>
        )}
      </div>
    </div>
  );
}
