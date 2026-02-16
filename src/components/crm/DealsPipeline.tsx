"use client";

import React, { useState } from "react";
import { DealValue, DEAL_STAGES, STAGE_PROBABILITY, CloseReasonModal } from "./shared";
import type { CrmDeal, DealStage } from "@/lib/types/database";
import type { CloseReasonResult } from "./shared";

interface DealRow extends CrmDeal {
  contact_name?: string;
  company_name?: string;
}

interface Props {
  deals: DealRow[];
  onStageChange: (dealId: string, newStage: DealStage, closeReason?: string, lostTo?: string) => void;
}

export default function DealsPipeline({ deals, onStageChange }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [closeModal, setCloseModal] = useState<{ dealId: string; stage: "won" | "lost" } | null>(null);

  /* ── Pipeline summary ── */
  const totalValue = deals.reduce((sum, d) => sum + (d.stage !== "lost" && d.stage !== "won" ? d.value : 0), 0);
  const weightedValue = deals.reduce((sum, d) => {
    if (d.stage === "won" || d.stage === "lost") return sum;
    return sum + d.value * (d.probability / 100);
  }, 0);
  const wonValue = deals.filter(d => d.stage === "won").reduce((sum, d) => sum + d.value, 0);

  /* ── Drag handlers ── */
  const handleDragStart = (e: React.DragEvent, dealId: string) => {
    setDragId(dealId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dealId);
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stage);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOver(null);
    const dealId = e.dataTransfer.getData("text/plain");
    if (!dealId) { setDragId(null); return; }

    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === stage) { setDragId(null); return; }

    // Show close reason modal for won/lost
    if (stage === "won" || stage === "lost") {
      setCloseModal({ dealId, stage });
      setDragId(null);
      return;
    }

    onStageChange(dealId, stage as DealStage);
    setDragId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOver(null);
  };

  const handleCloseConfirm = (result: CloseReasonResult) => {
    if (!closeModal) return;
    onStageChange(closeModal.dealId, closeModal.stage, result.close_reason, result.lost_to);
    setCloseModal(null);
  };

  /* ── Days in stage ── */
  const daysInStage = (deal: DealRow) => {
    const updated = new Date(deal.updated_at);
    const now = new Date();
    return Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
  };

  if (deals.length === 0) {
    return <div className="crm-empty">No deals yet. Add your first deal to see the pipeline.</div>;
  }

  return (
    <div className="crm-pipeline-wrap">
      {/* Close Reason Modal */}
      {closeModal && (
        <CloseReasonModal
          stage={closeModal.stage}
          onConfirm={handleCloseConfirm}
          onCancel={() => setCloseModal(null)}
        />
      )}

      {/* Summary bar */}
      <div className="crm-pipeline-summary">
        <div className="crm-pipeline-stat">
          <span className="crm-pipeline-stat-label">Pipeline</span>
          <span className="crm-pipeline-stat-value">
            <DealValue value={totalValue} />
          </span>
        </div>
        <div className="crm-pipeline-stat">
          <span className="crm-pipeline-stat-label">Weighted</span>
          <span className="crm-pipeline-stat-value">
            <DealValue value={weightedValue} />
          </span>
        </div>
        {wonValue > 0 && (
          <div className="crm-pipeline-stat">
            <span className="crm-pipeline-stat-label">Won</span>
            <span className="crm-pipeline-stat-value crm-pipeline-won">
              <DealValue value={wonValue} />
            </span>
          </div>
        )}
        <div className="crm-pipeline-stat">
          <span className="crm-pipeline-stat-label">Deals</span>
          <span className="crm-pipeline-stat-value">{deals.length}</span>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="crm-pipeline">
        {DEAL_STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage.value);
          const stageTotal = stageDeals.reduce((s, d) => s + d.value, 0);

          return (
            <div
              key={stage.value}
              className={`crm-pipeline-column ${dragOver === stage.value ? "crm-pipeline-column-dragover" : ""}`}
              onDragOver={(e) => handleDragOver(e, stage.value)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.value)}
            >
              <div className="crm-pipeline-header" style={{ borderTopColor: stage.color }}>
                <div className="crm-pipeline-header-top">
                  <span className="crm-pipeline-stage-name">{stage.label}</span>
                  <span className="crm-pipeline-stage-count">{stageDeals.length}</span>
                </div>
                {stageTotal > 0 && (
                  <div className="crm-pipeline-stage-total">
                    <DealValue value={stageTotal} />
                  </div>
                )}
              </div>

              <div className="crm-pipeline-cards">
                {stageDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className={`crm-deal-card ${dragId === deal.id ? "crm-deal-card-dragging" : ""}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, deal.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="crm-deal-card-title">{deal.title}</div>
                    <div className="crm-deal-card-value">
                      <DealValue value={deal.value} currency={deal.currency} />
                    </div>
                    {(deal.contact_name || deal.company_name) && (
                      <div className="crm-deal-card-meta">
                        {deal.contact_name && <span>{deal.contact_name}</span>}
                        {deal.contact_name && deal.company_name && <span> · </span>}
                        {deal.company_name && <span>{deal.company_name}</span>}
                      </div>
                    )}
                    {deal.notes && (
                      <div className="crm-deal-card-notes">{deal.notes.length > 80 ? deal.notes.slice(0, 80) + "..." : deal.notes}</div>
                    )}
                    {deal.next_steps && (
                      <div className="crm-deal-card-next-steps">
                        <span className="crm-deal-card-next-label">Next:</span> {deal.next_steps.length > 60 ? deal.next_steps.slice(0, 60) + "..." : deal.next_steps}
                      </div>
                    )}
                    {deal.close_reason && (deal.stage === "won" || deal.stage === "lost") && (
                      <div className="crm-deal-card-notes" style={{ fontStyle: "italic" }}>
                        {deal.stage === "won" ? "Won:" : "Lost:"} {deal.close_reason}
                        {deal.lost_to ? ` (to ${deal.lost_to})` : ""}
                      </div>
                    )}
                    <div className="crm-deal-card-footer">
                      <span className="crm-deal-card-days">{daysInStage(deal)}d</span>
                      <span className="crm-deal-card-prob">{deal.probability}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
