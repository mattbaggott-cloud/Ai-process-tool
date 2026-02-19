"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import type {
  Segment,
  SegmentType,
  SegmentStatus,
} from "@/lib/types/database";

/* ── Constants ─────────────────────────────────────────── */

const SEGMENT_TYPE_LABELS: Record<SegmentType, string> = {
  behavioral: "Behavioral",
  rfm: "RFM",
  product_affinity: "Product",
  lifecycle: "Lifecycle",
  custom: "Custom",
};

const SEGMENT_TYPE_COLORS: Record<SegmentType, string> = {
  behavioral: "#8b5cf6",
  rfm: "#3b82f6",
  product_affinity: "#10b981",
  lifecycle: "#f59e0b",
  custom: "#6b7280",
};

const STATUS_COLORS: Record<SegmentStatus, string> = {
  active: "#10b981",
  paused: "#f59e0b",
  archived: "#6b7280",
};

/* ── Helper: format date ────────────────────────────────── */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

/* ── Types ─────────────────────────────────────────────── */

interface SegmentWithMembers extends Segment {
  member_count?: number;
}

interface MemberRow {
  id: string;
  ecom_customer_id: string;
  score: number;
  assigned_at: string;
  customer_email?: string;
  customer_name?: string;
}

type ViewMode = "list" | "detail";

/* ── Component ─────────────────────────────────────────── */

export default function SegmentsView() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const supabase = createClient();

  const [view, setView] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<SegmentWithMembers[]>([]);
  const [profileCount, setProfileCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<SegmentType | "all">("all");

  // Detail view state
  const [activeSegment, setActiveSegment] = useState<SegmentWithMembers | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [childSegments, setChildSegments] = useState<SegmentWithMembers[]>([]);

  // Compute state
  const [computing, setComputing] = useState(false);
  const [computeMessage, setComputeMessage] = useState("");

  /* ── Load segments ───────────────────────────────────── */

  const loadSegments = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [segRes, memberRes, profileRes] = await Promise.all([
      supabase
        .from("segments")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("segment_members")
        .select("segment_id")
        .eq("org_id", orgId),
      supabase
        .from("customer_behavioral_profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
    ]);

    // Count members per segment
    const memberCounts: Record<string, number> = {};
    for (const m of memberRes.data ?? []) {
      const sid = m.segment_id as string;
      memberCounts[sid] = (memberCounts[sid] ?? 0) + 1;
    }

    const enriched: SegmentWithMembers[] = ((segRes.data ?? []) as unknown as Segment[]).map((s) => ({
      ...s,
      member_count: memberCounts[s.id] ?? s.customer_count ?? 0,
    }));

    setSegments(enriched);
    setProfileCount(profileRes.count ?? 0);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, orgId]);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  useEffect(() => {
    const handler = () => loadSegments();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadSegments]);

  /* ── Compute behavioral profiles ──────────────────────── */

  const handleCompute = async () => {
    setComputing(true);
    setComputeMessage("Computing behavioral profiles...");
    try {
      const res = await fetch("/api/segments/compute", { method: "POST" });
      if (!res.ok) throw new Error("Compute failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // Parse SSE events
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.type === "progress") {
                  setComputeMessage(evt.message || "Processing...");
                } else if (evt.type === "done") {
                  setComputeMessage(`Done! ${evt.profiles_updated ?? 0} profiles updated.`);
                }
              } catch { /* skip non-json lines */ }
            }
          }
        }
      }
      await loadSegments();
    } catch (err) {
      setComputeMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setComputing(false);
      setTimeout(() => setComputeMessage(""), 4000);
    }
  };

  /* ── Open segment detail ─────────────────────────────── */

  const openSegment = async (segment: SegmentWithMembers) => {
    setActiveSegment(segment);
    setView("detail");
    setMembersLoading(true);

    // Load members with customer info
    const { data: memberData } = await supabase
      .from("segment_members")
      .select("id, ecom_customer_id, score, assigned_at")
      .eq("org_id", orgId)
      .eq("segment_id", segment.id)
      .order("score", { ascending: false })
      .limit(50);

    if (memberData && memberData.length > 0) {
      // Fetch customer details
      const customerIds = memberData.map((m) => m.ecom_customer_id as string);
      const { data: customers } = await supabase
        .from("ecom_customers")
        .select("id, email, first_name, last_name")
        .in("id", customerIds);

      const custMap: Record<string, { email: string; name: string }> = {};
      for (const c of customers ?? []) {
        custMap[c.id as string] = {
          email: c.email as string,
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        };
      }

      setMembers(
        memberData.map((m) => ({
          id: m.id as string,
          ecom_customer_id: m.ecom_customer_id as string,
          score: m.score as number,
          assigned_at: m.assigned_at as string,
          customer_email: custMap[m.ecom_customer_id as string]?.email ?? "—",
          customer_name: custMap[m.ecom_customer_id as string]?.name ?? "—",
        }))
      );
    } else {
      setMembers([]);
    }

    // Load child segments
    const { data: children } = await supabase
      .from("segments")
      .select("*")
      .eq("org_id", orgId)
      .eq("parent_id", segment.id)
      .order("created_at", { ascending: false });

    setChildSegments((children ?? []) as unknown as SegmentWithMembers[]);
    setMembersLoading(false);
  };

  /* ── Delete segment ──────────────────────────────────── */

  const handleDelete = async (id: string) => {
    // Delete members first, then segment
    await supabase.from("segment_members").delete().eq("segment_id", id);
    await supabase.from("segments").delete().eq("id", id);
    if (view === "detail") setView("list");
    loadSegments();
  };

  /* ── Filtered segments ───────────────────────────────── */

  const filtered = segments.filter((s) => {
    if (filterType !== "all" && s.segment_type !== filterType) return false;
    if (searchTerm && !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const rootSegments = filtered.filter((s) => !s.parent_id);
  const childMap: Record<string, SegmentWithMembers[]> = {};
  for (const s of filtered) {
    if (s.parent_id) {
      if (!childMap[s.parent_id]) childMap[s.parent_id] = [];
      childMap[s.parent_id].push(s);
    }
  }

  /* ── Stats ───────────────────────────────────────────── */

  const totalMembers = segments.reduce((sum, s) => sum + (s.member_count ?? 0), 0);
  const activeCount = segments.filter((s) => s.status === "active").length;
  const typeBreakdown = segments.reduce<Record<string, number>>((acc, s) => {
    acc[s.segment_type] = (acc[s.segment_type] ?? 0) + 1;
    return acc;
  }, {});

  /* ── RENDER ──────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="crm-page">
        <div className="crm-header"><h1 className="crm-title">Segments</h1></div>
        <div className="crm-content"><div className="crm-loading">Loading segments...</div></div>
      </div>
    );
  }

  /* ── Detail View ─────────────────────────────────────── */

  if (view === "detail" && activeSegment) {
    return (
      <div className="crm-page">
        <div className="crm-header">
          <h1 className="crm-title">Segments</h1>
        </div>
        <div className="crm-content">
          <div className="crm-tab-content">
            <div className="crm-toolbar">
              <button className="btn btn-sm" onClick={() => setView("list")}>
                &larr; All Segments
              </button>
              <h2 className="crm-report-viewer-title">{activeSegment.name}</h2>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-sm"
                style={{ color: "#ef4444" }}
                onClick={() => handleDelete(activeSegment.id)}
              >
                Delete
              </button>
            </div>

            {activeSegment.description && (
              <p className="crm-report-description">{activeSegment.description}</p>
            )}

            {/* Meta bar */}
            <div className="crm-report-meta-bar">
              <span
                className="crm-report-meta-item"
                style={{ background: SEGMENT_TYPE_COLORS[activeSegment.segment_type] + "18", color: SEGMENT_TYPE_COLORS[activeSegment.segment_type] }}
              >
                {SEGMENT_TYPE_LABELS[activeSegment.segment_type]}
              </span>
              <span
                className="crm-report-meta-item"
                style={{ background: STATUS_COLORS[activeSegment.status] + "18", color: STATUS_COLORS[activeSegment.status] }}
              >
                {activeSegment.status}
              </span>
              <span className="crm-report-meta-item">
                {activeSegment.member_count ?? 0} member{(activeSegment.member_count ?? 0) !== 1 ? "s" : ""}
              </span>
              {activeSegment.branch_dimension && (
                <span className="crm-report-meta-item">
                  Branch: {activeSegment.branch_dimension} = {activeSegment.branch_value}
                </span>
              )}
              <span className="crm-report-meta-item">
                Created {fmtDate(activeSegment.created_at)}
              </span>
            </div>

            {/* Rules display */}
            <div className="seg-rules-card">
              <div className="seg-rules-title">Rules</div>
              <pre className="seg-rules-json">
                {JSON.stringify(activeSegment.rules, null, 2)}
              </pre>
            </div>

            {/* Child segments */}
            {childSegments.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="seg-section-title">Sub-Segments ({childSegments.length})</div>
                <div className="seg-grid">
                  {childSegments.map((child) => (
                    <button
                      key={child.id}
                      className="seg-card seg-card-clickable"
                      onClick={() => openSegment(child)}
                    >
                      <div className="seg-card-header">
                        <span className="seg-card-name">{child.name}</span>
                        <span
                          className="seg-type-badge"
                          style={{ background: SEGMENT_TYPE_COLORS[child.segment_type] + "18", color: SEGMENT_TYPE_COLORS[child.segment_type] }}
                        >
                          {SEGMENT_TYPE_LABELS[child.segment_type]}
                        </span>
                      </div>
                      {child.branch_dimension && (
                        <div className="seg-card-branch">
                          {child.branch_dimension}: {child.branch_value}
                        </div>
                      )}
                      <div className="seg-card-members">{child.customer_count ?? 0} members</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Members table */}
            <div style={{ marginTop: 16 }}>
              <div className="seg-section-title">Members{members.length > 0 ? ` (${members.length}${(activeSegment.member_count ?? 0) > 50 ? " of " + activeSegment.member_count : ""})` : ""}</div>
              {membersLoading ? (
                <div className="crm-loading">Loading members...</div>
              ) : members.length === 0 ? (
                <div className="crm-empty">
                  No members in this segment. Use the AI Copilot to compute behavioral profiles and assign members.
                </div>
              ) : (
                <div className="crm-table-wrap">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Email</th>
                        <th>Score</th>
                        <th>Assigned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id} className="crm-table-row">
                          <td className="crm-cell-name">{m.customer_name}</td>
                          <td>{m.customer_email}</td>
                          <td>
                            <span className="seg-score-badge">{m.score?.toFixed(1) ?? "—"}</span>
                          </td>
                          <td className="crm-cell-date">{fmtRelative(m.assigned_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── List View ───────────────────────────────────────── */

  return (
    <div className="crm-page">
      <div className="crm-header">
        <h1 className="crm-title">Segments</h1>
      </div>
      <div className="crm-content">
        {/* Stats bar */}
        <div className="seg-stats-bar">
          <div className="seg-stat">
            <div className="seg-stat-value">{segments.length}</div>
            <div className="seg-stat-label">Segments</div>
          </div>
          <div className="seg-stat">
            <div className="seg-stat-value">{activeCount}</div>
            <div className="seg-stat-label">Active</div>
          </div>
          <div className="seg-stat">
            <div className="seg-stat-value">{totalMembers.toLocaleString()}</div>
            <div className="seg-stat-label">Total Members</div>
          </div>
          <div className="seg-stat">
            <div className="seg-stat-value">{profileCount.toLocaleString()}</div>
            <div className="seg-stat-label">Profiles Computed</div>
          </div>
          {Object.entries(typeBreakdown).map(([type, count]) => (
            <div key={type} className="seg-stat">
              <div className="seg-stat-value" style={{ color: SEGMENT_TYPE_COLORS[type as SegmentType] }}>
                {count}
              </div>
              <div className="seg-stat-label">{SEGMENT_TYPE_LABELS[type as SegmentType]}</div>
            </div>
          ))}
        </div>

        <div className="crm-tab-content">
          {/* Toolbar */}
          <div className="crm-toolbar">
            <input
              className="crm-search-input"
              placeholder="Search segments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              className="crm-filter-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as SegmentType | "all")}
            >
              <option value="all">All Types</option>
              {Object.entries(SEGMENT_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCompute}
              disabled={computing}
            >
              {computing ? "Computing..." : "Compute Profiles"}
            </button>
          </div>

          {computeMessage && (
            <div className="seg-compute-banner">
              {computing && <span className="seg-spinner" />}
              {computeMessage}
            </div>
          )}

          {/* Segment list */}
          {filtered.length === 0 ? (
            <div className="crm-empty">
              {segments.length === 0
                ? "No segments yet. Use the AI Copilot to discover behavioral patterns and create segments, or click \"Compute Profiles\" to generate behavioral data."
                : "No segments match your filters."}
            </div>
          ) : (
            <div className="seg-grid">
              {rootSegments.map((segment) => (
                <React.Fragment key={segment.id}>
                  <SegmentCard
                    segment={segment}
                    onClick={() => openSegment(segment)}
                    onDelete={() => handleDelete(segment.id)}
                    depth={0}
                  />
                  {/* Render children indented */}
                  {(childMap[segment.id] ?? []).map((child) => (
                    <SegmentCard
                      key={child.id}
                      segment={child}
                      onClick={() => openSegment(child)}
                      onDelete={() => handleDelete(child.id)}
                      depth={1}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Segment Card Component ──────────────────────────────── */

function SegmentCard({
  segment,
  onClick,
  onDelete,
  depth,
}: {
  segment: SegmentWithMembers;
  onClick: () => void;
  onDelete: () => void;
  depth: number;
}) {
  return (
    <div
      className={`seg-card seg-card-clickable ${depth > 0 ? "seg-card-child" : ""}`}
      style={depth > 0 ? { marginLeft: depth * 24 } : undefined}
      onClick={onClick}
    >
      <div className="seg-card-header">
        <span className="seg-card-name">
          {depth > 0 && <span className="seg-card-tree-line">&lfloor; </span>}
          {segment.name}
        </span>
        <div className="seg-card-badges">
          <span
            className="seg-type-badge"
            style={{
              background: SEGMENT_TYPE_COLORS[segment.segment_type] + "18",
              color: SEGMENT_TYPE_COLORS[segment.segment_type],
            }}
          >
            {SEGMENT_TYPE_LABELS[segment.segment_type]}
          </span>
          <span
            className="seg-status-dot"
            style={{ background: STATUS_COLORS[segment.status] }}
            title={segment.status}
          />
        </div>
      </div>

      {segment.description && (
        <div className="seg-card-desc">{segment.description}</div>
      )}

      {segment.branch_dimension && (
        <div className="seg-card-branch">
          {segment.branch_dimension}: <strong>{segment.branch_value}</strong>
        </div>
      )}

      <div className="seg-card-footer">
        <span className="seg-card-members">
          {(segment.member_count ?? 0).toLocaleString()} member{(segment.member_count ?? 0) !== 1 ? "s" : ""}
        </span>
        <span className="seg-card-date">{fmtRelative(segment.created_at)}</span>
        <button
          className="crm-action-btn crm-action-delete"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
