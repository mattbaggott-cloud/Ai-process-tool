"use client";

import React, { useState, useEffect, useCallback } from "react";

/* ── Types ── */

interface MemberRow {
  id: string;
  email: string;
  name: string;
  orders_count: number;
  total_spent: number;
  lifecycle_stage: string | null;
  rfm_score: string | null;
  top_product: string | null;
}

interface CampaignMemberListProps {
  campaignId: string;
  groupId: string;
  customerCount: number;
  onClose: () => void;
}

const PAGE_SIZE = 50;

/* ── Helpers ── */

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/* ── Component ── */

export default function CampaignMemberList({
  campaignId,
  groupId,
  customerCount,
  onClose,
}: CampaignMemberListProps) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/strategy?action=members&groupId=${groupId}&page=${page}&limit=${PAGE_SIZE}`
      );
      if (!res.ok) {
        setMembers([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setMembers(data.members ?? []);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId, groupId, page]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const startIdx = (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(page * PAGE_SIZE, customerCount);

  return (
    <div className="campaign-member-list">
      {/* Header */}
      <div className="campaign-member-header">
        <div className="campaign-member-title">
          Members
          {customerCount > 0 && (
            <span className="campaign-member-range">
              {startIdx}–{endIdx} of {customerCount.toLocaleString()}
            </span>
          )}
        </div>
        <button
          className="campaign-member-close"
          onClick={onClose}
          title="Close member list"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="campaign-member-loading">Loading members...</div>
      ) : members.length === 0 ? (
        <div className="campaign-member-empty">No members found</div>
      ) : (
        <>
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Lifecycle</th>
                  <th>RFM</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                  <th>Top Product</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="crm-table-row">
                    <td className="crm-cell-name">{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      {m.lifecycle_stage ? (
                        <span className="campaign-member-lifecycle-badge">
                          {capitalise(m.lifecycle_stage)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {m.rfm_score ? (
                        <span className="campaign-member-rfm">{m.rfm_score}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{m.orders_count}</td>
                    <td>{fmtCurrency(m.total_spent)}</td>
                    <td className="campaign-member-product">
                      {m.top_product || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="campaign-pagination" style={{ marginTop: 12 }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
