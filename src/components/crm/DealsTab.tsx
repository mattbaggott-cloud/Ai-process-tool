"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge, DealValue, DEAL_STAGES, STAGE_PROBABILITY, formatCurrency } from "./shared";
import DealsPipeline from "./DealsPipeline";
import type { CrmDeal, DealStage } from "@/lib/types/database";

type DealFilter = "all" | "active" | "won" | "lost";

interface DealRow extends CrmDeal {
  contact_name?: string;
  company_name?: string;
}

export default function DealsTab() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [deals, setDeals] = useState<DealRow[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "pipeline">("pipeline");
  const [dealFilter, setDealFilter] = useState<DealFilter>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    value: "",
    stage: "lead" as DealStage,
    contact_id: "",
    company_id: "",
    expected_close_date: "",
    notes: "",
    next_steps: "",
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [dealsRes, contactsRes, companiesRes] = await Promise.all([
      supabase.from("crm_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, first_name, last_name"),
      supabase.from("crm_companies").select("id, name"),
    ]);

    const contactMap: Record<string, string> = {};
    const companyMap: Record<string, string> = {};
    if (contactsRes.data) {
      for (const c of contactsRes.data) contactMap[c.id] = `${c.first_name} ${c.last_name}`.trim();
      setContacts(contactsRes.data.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() })));
    }
    if (companiesRes.data) {
      for (const c of companiesRes.data) companyMap[c.id] = c.name;
      setCompanies(companiesRes.data.map(c => ({ id: c.id, name: c.name })));
    }

    if (dealsRes.data) {
      setDeals(
        (dealsRes.data as CrmDeal[]).map((d) => ({
          ...d,
          contact_name: d.contact_id ? contactMap[d.contact_id] ?? "" : "",
          company_name: d.company_id ? companyMap[d.company_id] ?? "" : "",
        }))
      );
    }
    setLoading(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.title.trim()) return;

    const stage = form.stage;
    const prob = STAGE_PROBABILITY[stage] ?? 10;

    const { error } = await supabase.from("crm_deals").insert({
      user_id: user.id,
      title: form.title.trim(),
      value: parseFloat(form.value) || 0,
      stage,
      probability: prob,
      contact_id: form.contact_id || null,
      company_id: form.company_id || null,
      expected_close_date: form.expected_close_date || null,
      notes: form.notes.trim(),
      next_steps: form.next_steps.trim(),
    });

    if (!error) {
      setForm({ title: "", value: "", stage: "lead", contact_id: "", company_id: "", expected_close_date: "", notes: "", next_steps: "" });
      setShowForm(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleStageChange = async (dealId: string, newStage: DealStage, closeReason?: string, lostTo?: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    const oldStage = deal.stage;
    const prob = STAGE_PROBABILITY[newStage] ?? 10;

    const updates: Record<string, unknown> = {
      stage: newStage,
      probability: prob,
      updated_at: new Date().toISOString(),
    };

    // Handle close fields for won/lost
    if (newStage === "won" || newStage === "lost") {
      updates.closed_at = new Date().toISOString();
      if (closeReason) updates.close_reason = closeReason;
      if (lostTo) updates.lost_to = lostTo;
    }
    // Clear close fields when moving away from won/lost
    if (newStage !== "won" && newStage !== "lost" && (oldStage === "won" || oldStage === "lost")) {
      updates.closed_at = null;
      updates.close_reason = "";
      updates.lost_to = "";
    }

    await supabase.from("crm_deals").update(updates).eq("id", dealId);

    // Record stage history
    if (oldStage !== newStage && user) {
      await supabase.from("crm_deal_stage_history").insert({
        user_id: user.id,
        deal_id: dealId,
        from_stage: oldStage,
        to_stage: newStage,
        notes: closeReason || "",
      });
    }

    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Filtered deals ── */
  const activeDeals = deals.filter(d => d.stage !== "won" && d.stage !== "lost");
  const wonDeals = deals.filter(d => d.stage === "won");
  const lostDeals = deals.filter(d => d.stage === "lost");
  const filteredDeals =
    dealFilter === "active" ? activeDeals
    : dealFilter === "won" ? wonDeals
    : dealFilter === "lost" ? lostDeals
    : deals;

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (loading) return <div className="crm-loading">Loading deals...</div>;

  return (
    <div className="crm-tab-content">
      <div className="crm-toolbar">
        {/* Deal filter tabs */}
        <div className="crm-deal-filter-tabs">
          {([
            { key: "all", label: `All (${deals.length})` },
            { key: "active", label: `Active (${activeDeals.length})` },
            { key: "won", label: `Won (${wonDeals.length})` },
            { key: "lost", label: `Lost (${lostDeals.length})` },
          ] as { key: DealFilter; label: string }[]).map((f) => (
            <button
              key={f.key}
              className={`crm-deal-filter-tab ${dealFilter === f.key ? "crm-deal-filter-tab-active" : ""}`}
              onClick={() => setDealFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="crm-view-toggle">
          <button
            className={`crm-view-btn ${viewMode === "pipeline" ? "crm-view-btn-active" : ""}`}
            onClick={() => setViewMode("pipeline")}
          >
            Pipeline
          </button>
          <button
            className={`crm-view-btn ${viewMode === "list" ? "crm-view-btn-active" : ""}`}
            onClick={() => setViewMode("list")}
          >
            List
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Deal"}
        </button>
      </div>

      {showForm && (
        <form className="crm-inline-form" onSubmit={handleSubmit}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="Deal title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <input className="crm-input" placeholder="Value ($)" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            <select className="crm-input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as DealStage })}>
              {DEAL_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className="crm-input" type="date" placeholder="Expected close" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} />
            <select className="crm-input" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
              <option value="">No contact</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="crm-input" value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              <option value="">No company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <textarea className="crm-input crm-textarea" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <textarea className="crm-input crm-textarea" placeholder="Next steps" value={form.next_steps} onChange={(e) => setForm({ ...form, next_steps: e.target.value })} rows={1} />
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Add Deal</button>
        </form>
      )}

      {viewMode === "pipeline" ? (
        <DealsPipeline deals={filteredDeals} onStageChange={handleStageChange} />
      ) : (
        <>
          {filteredDeals.length === 0 ? (
            <div className="crm-empty">
              {deals.length === 0
                ? "No deals yet. Add your first deal or ask AI to create one."
                : `No ${dealFilter === "all" ? "" : dealFilter} deals.`}
            </div>
          ) : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Value</th>
                    <th>Stage</th>
                    <th>Contact</th>
                    <th>Company</th>
                    <th>{dealFilter === "won" || dealFilter === "lost" ? "Close Date" : "Expected Close"}</th>
                    {dealFilter === "won" && <th>Win Reason</th>}
                    {dealFilter === "lost" && <th>Loss Reason</th>}
                    {dealFilter === "lost" && <th>Lost To</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((d) => (
                    <tr key={d.id} className="crm-table-row crm-clickable" onClick={() => router.push(`/crm/deals/${d.id}`)}>
                      <td className="crm-cell-name">{d.title}</td>
                      <td><DealValue value={d.value} currency={d.currency} /></td>
                      <td>
                        <select
                          className="crm-stage-select"
                          value={d.stage}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); handleStageChange(d.id, e.target.value as DealStage); }}
                        >
                          {DEAL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      <td>{d.contact_name || "\u2014"}</td>
                      <td>{d.company_name || "\u2014"}</td>
                      <td>
                        {(dealFilter === "won" || dealFilter === "lost")
                          ? (d.closed_at ? fmt(d.closed_at) : "\u2014")
                          : (d.expected_close_date ? fmt(d.expected_close_date) : "\u2014")}
                      </td>
                      {dealFilter === "won" && <td>{d.close_reason || "\u2014"}</td>}
                      {dealFilter === "lost" && <td>{d.close_reason || "\u2014"}</td>}
                      {dealFilter === "lost" && <td>{d.lost_to || "\u2014"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
