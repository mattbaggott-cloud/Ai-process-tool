"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import VariantCard from "./VariantCard";
import type { EmailCampaign, EmailCustomerVariant } from "@/lib/types/database";

/* ── Types ──────────────────────────────────────────────── */
interface Props {
  campaignId: string;
  onBack: () => void;
}

type StatusFilter = "all" | "draft" | "approved" | "edited" | "rejected" | "sent";

/* ── Helpers ────────────────────────────────────────────── */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

const statusBadgeClass: Record<string, string> = {
  draft: "campaign-badge-gray",
  generating: "campaign-badge-blue",
  review: "campaign-badge-yellow",
  approved: "campaign-badge-green",
  sending: "campaign-badge-blue",
  sent: "campaign-badge-green",
  paused: "campaign-badge-gray",
  failed: "campaign-badge-red",
};

/* ── Component ──────────────────────────────────────────── */
export default function CampaignReviewView({ campaignId, onBack }: Props) {
  const supabase = useMemo(() => createClient(), []);

  /* ── State ──────────────────────────────────────────────── */
  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [variants, setVariants] = useState<EmailCustomerVariant[]>([]);
  const [totalVariants, setTotalVariants] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [editingVariant, setEditingVariant] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editPreview, setEditPreview] = useState("");
  const [editHtml, setEditHtml] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const LIMIT = 20;

  /* ── Load campaign ─────────────────────────────────────── */
  const loadCampaign = useCallback(async () => {
    const { data } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    if (data) {
      const camp = data as EmailCampaign;

      // Self-healing: if campaign is "review" but all variants are approved, auto-promote
      if (camp.status === "review" && (camp.approved_count ?? 0) > 0) {
        const { count: draftCount } = await supabase
          .from("email_customer_variants")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("status", "draft");

        if ((draftCount ?? 0) === 0) {
          await supabase
            .from("email_campaigns")
            .update({ status: "approved", updated_at: new Date().toISOString() })
            .eq("id", campaignId);
          camp.status = "approved";
        }
      }

      setCampaign(camp);
    }
  }, [supabase, campaignId]);

  /* ── Load variants ─────────────────────────────────────── */
  const loadVariants = useCallback(async () => {
    setLoading(true);
    const offset = (page - 1) * LIMIT;

    let query = supabase
      .from("email_customer_variants")
      .select("*", { count: "exact" })
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .range(offset, offset + LIMIT - 1);

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, count } = await query;
    setVariants((data as EmailCustomerVariant[]) ?? []);
    setTotalVariants(count ?? 0);
    setLoading(false);
  }, [supabase, campaignId, statusFilter, page]);

  useEffect(() => {
    loadCampaign();
    loadVariants();
  }, [loadCampaign, loadVariants]);

  /* ── Derived ───────────────────────────────────────────── */
  const activeVariant = variants[activeIdx] ?? null;
  const totalPages = Math.ceil(totalVariants / LIMIT);

  /* ── Counts per status (from campaign record) ──────────── */
  const counts = {
    total: campaign?.total_variants ?? 0,
    approved: campaign?.approved_count ?? 0,
    sent: campaign?.sent_count ?? 0,
    failed: campaign?.failed_count ?? 0,
    draft: Math.max(
      0,
      (campaign?.total_variants ?? 0) -
        (campaign?.approved_count ?? 0) -
        (campaign?.sent_count ?? 0) -
        (campaign?.failed_count ?? 0)
    ),
  };

  /* ── Actions ───────────────────────────────────────────── */
  const handleAction = async (variantId: string, action: "approve" | "reject" | "edit", editedContent?: Record<string, string>) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/variants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, action, editedContent }),
      });
      if (res.ok) {
        await loadVariants();
        await loadCampaign();
      }
    } finally {
      setActionLoading(false);
      setEditingVariant(null);
    }
  };

  const handleApproveAll = async () => {
    setActionLoading(true);
    try {
      const draftVariants = variants.filter((v) => v.status === "draft");
      for (const v of draftVariants) {
        await fetch(`/api/campaigns/${campaignId}/variants`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId: v.id, action: "approve" }),
        });
      }
      await loadVariants();
      await loadCampaign();
    } finally {
      setActionLoading(false);
    }
  };

  const handleSend = async () => {
    setSendStatus("sending");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (res.ok) {
        setSendStatus("sent");
        await loadCampaign();
        await loadVariants();
      } else {
        setSendStatus("error");
      }
    } catch {
      setSendStatus("error");
    }
  };

  /* ── Edit mode ─────────────────────────────────────────── */
  const startEdit = (v: EmailCustomerVariant) => {
    setEditingVariant(v.id);
    const edited = v.edited_content as Record<string, string> | null;
    setEditSubject(edited?.subject_line || v.subject_line || "");
    setEditPreview(edited?.preview_text || v.preview_text || "");
    setEditHtml(edited?.body_html || v.body_html || "");
  };

  const saveEdit = () => {
    if (!editingVariant) return;
    handleAction(editingVariant, "edit", {
      subject_line: editSubject,
      preview_text: editPreview,
      body_html: editHtml,
    });
  };

  /* ── Keyboard shortcuts ────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setActiveIdx((i) => Math.max(0, i - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIdx((i) => Math.min(variants.length - 1, i + 1));
          break;
        case "a":
        case "A":
          if (activeVariant && activeVariant.status === "draft") {
            handleAction(activeVariant.id, "approve");
          }
          break;
        case "r":
        case "R":
          if (activeVariant && activeVariant.status === "draft") {
            handleAction(activeVariant.id, "reject");
          }
          break;
        case "e":
        case "E":
          if (activeVariant) {
            startEdit(activeVariant);
          }
          break;
        case "Escape":
          if (editingVariant) {
            setEditingVariant(null);
          } else if (showSendConfirm) {
            setShowSendConfirm(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVariant, variants, editingVariant, showSendConfirm]);

  /* ── Scroll active card into view ──────────────────────── */
  useEffect(() => {
    if (listRef.current) {
      const activeCard = listRef.current.querySelector(
        ".campaign-variant-card-active"
      );
      activeCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIdx]);

  /* ── Get email body for preview ────────────────────────── */
  const getEmailHtml = (v: EmailCustomerVariant | null): string => {
    if (!v) return "";
    const edited = v.edited_content as Record<string, string> | null;
    return edited?.body_html || v.body_html || "";
  };

  const getSubject = (v: EmailCustomerVariant | null): string => {
    if (!v) return "";
    const edited = v.edited_content as Record<string, string> | null;
    return edited?.subject_line || v.subject_line || "(no subject)";
  };

  const getPreviewText = (v: EmailCustomerVariant | null): string => {
    if (!v) return "";
    const edited = v.edited_content as Record<string, string> | null;
    return edited?.preview_text || v.preview_text || "";
  };

  /* ── Progress bar segments ─────────────────────────────── */
  const progressSegments = useMemo(() => {
    const total = counts.total || 1;
    return {
      approved: (counts.approved / total) * 100,
      sent: (counts.sent / total) * 100,
      failed: (counts.failed / total) * 100,
      draft: (counts.draft / total) * 100,
    };
  }, [counts]);

  /* ── Render ────────────────────────────────────────────── */
  if (!campaign) {
    return <div className="crm-loading">Loading campaign...</div>;
  }

  return (
    <div className="campaign-review">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="campaign-review-header">
        <div className="campaign-review-header-left">
          <button className="campaign-back-btn" onClick={onBack}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12 5 8l5-4" />
            </svg>
            Back
          </button>
          <h2 className="campaign-review-title">{campaign.name}</h2>
          <span className={`campaign-badge ${statusBadgeClass[campaign.status] || "campaign-badge-gray"}`}>
            {capitalise(campaign.status)}
          </span>
        </div>
        <div className="campaign-review-header-right">
          <button
            className="campaign-action-btn campaign-action-approve-all"
            onClick={handleApproveAll}
            disabled={actionLoading || counts.draft === 0}
          >
            Approve All Draft ({counts.draft})
          </button>
          <button
            className="campaign-action-btn campaign-action-send"
            onClick={() => setShowSendConfirm(true)}
            disabled={actionLoading || counts.approved === 0}
          >
            Send Campaign
          </button>
        </div>
      </div>

      {/* ── Metrics bar ──────────────────────────────────── */}
      <div className="campaign-metrics-bar campaign-metrics-compact">
        <div className="campaign-metric-card">
          <div className="campaign-metric-value">{counts.total}</div>
          <div className="campaign-metric-label">Total</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-green">{counts.approved}</div>
          <div className="campaign-metric-label">Approved</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-green">{counts.sent}</div>
          <div className="campaign-metric-label">Sent</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-red">{counts.failed}</div>
          <div className="campaign-metric-label">Failed</div>
        </div>
        <div className="campaign-metric-card">
          <div className="campaign-metric-value campaign-metric-gray">{counts.draft}</div>
          <div className="campaign-metric-label">Draft</div>
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────── */}
      <div className="campaign-progress-bar">
        <div
          className="campaign-progress-segment campaign-progress-sent"
          style={{ width: `${progressSegments.sent}%` }}
          title={`Sent: ${counts.sent}`}
        />
        <div
          className="campaign-progress-segment campaign-progress-approved"
          style={{ width: `${progressSegments.approved}%` }}
          title={`Approved: ${counts.approved}`}
        />
        <div
          className="campaign-progress-segment campaign-progress-failed"
          style={{ width: `${progressSegments.failed}%` }}
          title={`Failed: ${counts.failed}`}
        />
        <div
          className="campaign-progress-segment campaign-progress-draft"
          style={{ width: `${progressSegments.draft}%` }}
          title={`Draft: ${counts.draft}`}
        />
      </div>

      {/* ── Status filter pills ──────────────────────────── */}
      <div className="campaign-filter-pills campaign-review-filters">
        {(["all", "draft", "approved", "edited", "rejected", "sent"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            className={`campaign-filter-pill ${statusFilter === s ? "campaign-filter-pill-active" : ""}`}
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
              setActiveIdx(0);
            }}
          >
            {capitalise(s)}
          </button>
        ))}
      </div>

      {/* ── Split pane ───────────────────────────────────── */}
      <div className="campaign-split-pane">
        {/* Left: variant list */}
        <div className="campaign-split-left" ref={listRef}>
          {loading ? (
            <div className="crm-loading" style={{ padding: "2rem" }}>Loading variants...</div>
          ) : variants.length === 0 ? (
            <div className="campaign-empty" style={{ padding: "2rem" }}>
              <p>No variants match this filter.</p>
            </div>
          ) : (
            <>
              {variants.map((v, idx) => (
                <VariantCard
                  key={v.id}
                  variant={v}
                  isActive={idx === activeIdx}
                  onClick={() => setActiveIdx(idx)}
                />
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="campaign-pagination">
                  <button
                    disabled={page <= 1}
                    onClick={() => { setPage((p) => p - 1); setActiveIdx(0); }}
                  >
                    Prev
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => { setPage((p) => p + 1); setActiveIdx(0); }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: email preview */}
        <div className="campaign-split-right">
          {activeVariant ? (
            <>
              {/* Customer context */}
              <div className="campaign-customer-context">
                <div className="campaign-customer-header">
                  <div className="campaign-customer-avatar">
                    {(activeVariant.customer_name || activeVariant.customer_email || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="campaign-customer-name">
                      {activeVariant.customer_name || "Unknown Customer"}
                    </div>
                    <div className="campaign-customer-email-text">
                      {activeVariant.customer_email}
                    </div>
                  </div>
                </div>
                {activeVariant.personalization_context && (
                  <div className="campaign-context-pills">
                    {Object.entries(activeVariant.personalization_context).map(([k, v]) => (
                      <span key={k} className="campaign-context-pill">
                        <strong>{capitalise(k)}:</strong>{" "}
                        {typeof v === "number"
                          ? k.includes("revenue") || k.includes("aov")
                            ? `$${v.toLocaleString()}`
                            : v.toLocaleString()
                          : String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Subject & preview text */}
              <div className="campaign-email-meta">
                <div className="campaign-email-subject">
                  <span className="campaign-email-label">Subject:</span>{" "}
                  {getSubject(activeVariant)}
                </div>
                {getPreviewText(activeVariant) && (
                  <div className="campaign-email-preview-text">
                    <span className="campaign-email-label">Preview:</span>{" "}
                    {getPreviewText(activeVariant)}
                  </div>
                )}
              </div>

              {/* Email HTML preview in sandboxed iframe */}
              <div className="campaign-email-iframe-wrap">
                {editingVariant === activeVariant.id ? (
                  /* Edit mode */
                  <div className="campaign-edit-form">
                    <label>
                      Subject Line
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="campaign-edit-input"
                      />
                    </label>
                    <label>
                      Preview Text
                      <input
                        type="text"
                        value={editPreview}
                        onChange={(e) => setEditPreview(e.target.value)}
                        className="campaign-edit-input"
                      />
                    </label>
                    <label>
                      HTML Body
                      <textarea
                        value={editHtml}
                        onChange={(e) => setEditHtml(e.target.value)}
                        className="campaign-edit-textarea"
                        rows={16}
                      />
                    </label>
                    <div className="campaign-edit-actions">
                      <button
                        className="campaign-action-btn campaign-action-approve"
                        onClick={saveEdit}
                        disabled={actionLoading}
                      >
                        Save Changes
                      </button>
                      <button
                        className="campaign-action-btn campaign-action-secondary"
                        onClick={() => setEditingVariant(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Preview mode */
                  <iframe
                    className="campaign-email-iframe"
                    sandbox="allow-same-origin"
                    srcDoc={getEmailHtml(activeVariant) || "<p style='color:#999;text-align:center;padding:2rem'>No HTML content</p>"}
                    title="Email preview"
                  />
                )}
              </div>

              {/* Action buttons */}
              {editingVariant !== activeVariant.id && (
                <div className="campaign-actions-bar">
                  <button
                    className="campaign-action-btn campaign-action-approve"
                    onClick={() => handleAction(activeVariant.id, "approve")}
                    disabled={actionLoading || activeVariant.status === "approved" || activeVariant.status === "sent"}
                    title="Keyboard: A"
                  >
                    Approve
                  </button>
                  <button
                    className="campaign-action-btn campaign-action-edit"
                    onClick={() => startEdit(activeVariant)}
                    disabled={actionLoading || activeVariant.status === "sent"}
                    title="Keyboard: E"
                  >
                    Edit
                  </button>
                  <button
                    className="campaign-action-btn campaign-action-reject"
                    onClick={() => handleAction(activeVariant.id, "reject")}
                    disabled={actionLoading || activeVariant.status === "rejected" || activeVariant.status === "sent"}
                    title="Keyboard: R"
                  >
                    Reject
                  </button>
                </div>
              )}

              {/* Keyboard hint */}
              <div className="campaign-keyboard-hints">
                <span>
                  <kbd>↑</kbd><kbd>↓</kbd> Navigate
                </span>
                <span>
                  <kbd>A</kbd> Approve
                </span>
                <span>
                  <kbd>E</kbd> Edit
                </span>
                <span>
                  <kbd>R</kbd> Reject
                </span>
                <span>
                  <kbd>Esc</kbd> Cancel
                </span>
              </div>
            </>
          ) : (
            <div className="campaign-empty" style={{ padding: "3rem", textAlign: "center" }}>
              <p>Select a variant from the list to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Send confirmation modal ──────────────────────── */}
      {showSendConfirm && (
        <div className="campaign-send-overlay" onClick={() => setShowSendConfirm(false)}>
          <div className="campaign-send-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Send Campaign</h3>
            <div className="campaign-send-summary">
              <p><strong>{campaign.name}</strong></p>
              <p>Channel: {capitalise(campaign.delivery_channel || "Unknown")}</p>
              <p>
                Ready to send: <strong>{counts.approved} approved</strong> variants
                {counts.draft > 0 && (
                  <span className="campaign-send-warning">
                    {" "}({counts.draft} still in draft)
                  </span>
                )}
              </p>
            </div>
            {sendStatus === "error" && (
              <div className="campaign-send-error">
                Send failed. Please try again.
              </div>
            )}
            {sendStatus === "sent" ? (
              <div className="campaign-send-success">
                Campaign sent successfully!
                <button
                  className="campaign-action-btn campaign-action-secondary"
                  onClick={() => {
                    setShowSendConfirm(false);
                    setSendStatus("idle");
                  }}
                  style={{ marginTop: "1rem" }}
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="campaign-send-actions">
                <button
                  className="campaign-action-btn campaign-action-send"
                  onClick={handleSend}
                  disabled={sendStatus === "sending"}
                >
                  {sendStatus === "sending" ? "Sending..." : "Confirm Send"}
                </button>
                <button
                  className="campaign-action-btn campaign-action-secondary"
                  onClick={() => setShowSendConfirm(false)}
                  disabled={sendStatus === "sending"}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
