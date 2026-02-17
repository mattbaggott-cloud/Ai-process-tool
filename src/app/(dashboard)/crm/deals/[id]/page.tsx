"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import {
  StatusBadge,
  ActivityIcon,
  ActivityLabel,
  DealValue,
  DEAL_STAGES,
  STAGE_PROBABILITY,
  formatCurrency,
  CloseReasonModal,
} from "@/components/crm/shared";
import CustomFieldsSection from "@/components/crm/CustomFieldsSection";
import type {
  CrmDeal,
  CrmContact,
  CrmCompany,
  CrmActivity,
  CrmDealStageHistory,
  CrmDealLineItem,
  CrmProduct,
  DealStage,
} from "@/lib/types/database";

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const supabase = createClient();

  const [deal, setDeal] = useState<CrmDeal | null>(null);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [companyContacts, setCompanyContacts] = useState<CrmContact[]>([]);
  const [primaryContact, setPrimaryContact] = useState<CrmContact | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [stageHistory, setStageHistory] = useState<CrmDealStageHistory[]>([]);
  const [lineItems, setLineItems] = useState<CrmDealLineItem[]>([]);
  const [products, setProducts] = useState<CrmProduct[]>([]);
  const [showLineItemForm, setShowLineItemForm] = useState(false);
  const [lineItemForm, setLineItemForm] = useState({ product_id: "", quantity: "1", unit_price: "", discount: "0", notes: "" });
  const [allContacts, setAllContacts] = useState<{ id: string; name: string }[]>([]);
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CrmDeal & { contact_id_edit: string; company_id_edit: string }>>({});
  const [showCloseModal, setShowCloseModal] = useState<"won" | "lost" | null>(null);
  const [pendingStage, setPendingStage] = useState<DealStage | null>(null);
  const [pendingStageSource, setPendingStageSource] = useState<"dropdown" | "edit">("dropdown");

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);

    const { data: dealData } = await supabase
      .from("crm_deals")
      .select("*")
      .eq("id", id)
      .single();

    if (!dealData) { setLoading(false); return; }
    setDeal(dealData as CrmDeal);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promises: any[] = [
      supabase.from("crm_activities").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, first_name, last_name"),
      supabase.from("crm_companies").select("id, name"),
      supabase.from("crm_deal_stage_history").select("*").eq("deal_id", id).order("changed_at", { ascending: false }),
      supabase.from("crm_deal_line_items").select("*").eq("deal_id", id).order("created_at", { ascending: true }),
      supabase.from("crm_products").select("*").eq("is_active", true).order("name"),
    ];
    // Fetch primary contact
    if (dealData.contact_id) {
      promises.push(supabase.from("crm_contacts").select("*").eq("id", dealData.contact_id).single());
    }
    // Fetch company
    if (dealData.company_id) {
      promises.push(supabase.from("crm_companies").select("*").eq("id", dealData.company_id).single());
      // Fetch ALL contacts associated with this company
      promises.push(supabase.from("crm_contacts").select("*").eq("company_id", dealData.company_id).order("first_name"));
    }

    const results = await Promise.all(promises);

    const activitiesResult = results[0] as { data: CrmActivity[] | null };
    if (activitiesResult.data) setActivities(activitiesResult.data);

    const contactsListResult = results[1] as { data: { id: string; first_name: string; last_name: string }[] | null };
    if (contactsListResult.data) {
      setAllContacts(contactsListResult.data.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() })));
    }
    const companiesListResult = results[2] as { data: { id: string; name: string }[] | null };
    if (companiesListResult.data) {
      setAllCompanies(companiesListResult.data.map(c => ({ id: c.id, name: c.name })));
    }

    const historyResult = results[3] as { data: CrmDealStageHistory[] | null };
    if (historyResult.data) setStageHistory(historyResult.data);

    const lineItemsResult = results[4] as { data: CrmDealLineItem[] | null };
    if (lineItemsResult.data) setLineItems(lineItemsResult.data);

    const productsResult = results[5] as { data: CrmProduct[] | null };
    if (productsResult.data) setProducts(productsResult.data);

    let idx = 6;
    if (dealData.contact_id) {
      const contactResult = results[idx] as { data: CrmContact | null };
      if (contactResult?.data) setPrimaryContact(contactResult.data);
      else setPrimaryContact(null);
      idx++;
    } else {
      setPrimaryContact(null);
    }
    if (dealData.company_id) {
      const companyResult = results[idx] as { data: CrmCompany | null };
      if (companyResult?.data) setCompany(companyResult.data);
      else setCompany(null);
      idx++;
      const companyContactsResult = results[idx] as { data: CrmContact[] | null };
      if (companyContactsResult?.data) setCompanyContacts(companyContactsResult.data);
      else setCompanyContacts([]);
    } else {
      setCompany(null);
      setCompanyContacts([]);
    }

    setLoading(false);
  }, [user?.id, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Inline stage change from dropdown (Fix #4) ── */
  const handleQuickStageChange = async (newStage: DealStage) => {
    if (!deal || !user || newStage === deal.stage) return;

    // Show close reason modal for won/lost
    if (newStage === "won" || newStage === "lost") {
      setPendingStage(newStage);
      setPendingStageSource("dropdown");
      setShowCloseModal(newStage);
      return;
    }

    const prob = STAGE_PROBABILITY[newStage] ?? 10;
    const oldStage = deal.stage;
    const updates: Record<string, unknown> = {
      stage: newStage,
      probability: prob,
      updated_at: new Date().toISOString(),
    };
    // Clear close fields if moving away from won/lost
    if (oldStage === "won" || oldStage === "lost") {
      updates.closed_at = null;
      updates.close_reason = "";
      updates.lost_to = "";
    }

    await supabase.from("crm_deals").update(updates).eq("id", deal.id);
    await supabase.from("crm_deal_stage_history").insert({
      user_id: user.id,
      org_id: orgId,
      deal_id: deal.id,
      from_stage: oldStage,
      to_stage: newStage,
    });
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Line Items ── */
  const handleAddLineItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !deal) return;
    const product = products.find(p => p.id === lineItemForm.product_id);
    const qty = parseInt(lineItemForm.quantity) || 1;
    const price = parseFloat(lineItemForm.unit_price) || (product?.unit_price ?? 0);
    const disc = parseFloat(lineItemForm.discount) || 0;
    const total = Math.round(qty * price * (1 - disc / 100) * 100) / 100;

    await supabase.from("crm_deal_line_items").insert({
      user_id: user.id,
      org_id: orgId,
      deal_id: deal.id,
      product_id: lineItemForm.product_id || null,
      product_name: product?.name || "Custom Item",
      quantity: qty,
      unit_price: price,
      discount: disc,
      total,
      notes: lineItemForm.notes.trim(),
    });
    setLineItemForm({ product_id: "", quantity: "1", unit_price: "", discount: "0", notes: "" });
    setShowLineItemForm(false);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const handleDeleteLineItem = async (itemId: string) => {
    await supabase.from("crm_deal_line_items").delete().eq("id", itemId);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const lineItemTotal = lineItems.reduce((s, li) => s + (li.total || 0), 0);

  /* ── Edit mode ── */
  const handleEdit = () => {
    if (!deal) return;
    setEditForm({
      title: deal.title,
      value: deal.value,
      stage: deal.stage,
      probability: deal.probability,
      expected_close_date: deal.expected_close_date,
      notes: deal.notes,
      next_steps: deal.next_steps,
      close_reason: deal.close_reason,
      lost_to: deal.lost_to,
      contact_id_edit: deal.contact_id ?? "",
      company_id_edit: deal.company_id ?? "",
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!deal) return;
    const { contact_id_edit, company_id_edit, ...rest } = editForm;
    const oldStage = deal.stage;
    const newStage = rest.stage as DealStage;

    if (newStage !== oldStage && (newStage === "won" || newStage === "lost") && !rest.close_reason) {
      setPendingStage(newStage);
      setPendingStageSource("edit");
      setShowCloseModal(newStage);
      return;
    }

    const updates: Record<string, unknown> = {
      ...rest,
      contact_id: contact_id_edit || null,
      company_id: company_id_edit || null,
      updated_at: new Date().toISOString(),
    };

    if (newStage !== oldStage && (newStage === "won" || newStage === "lost")) {
      updates.closed_at = new Date().toISOString();
    }
    if (newStage !== oldStage && newStage !== "won" && newStage !== "lost" && (oldStage === "won" || oldStage === "lost")) {
      updates.closed_at = null;
      updates.close_reason = "";
      updates.lost_to = "";
    }

    const { error } = await supabase.from("crm_deals").update(updates).eq("id", deal.id);

    if (!error) {
      if (newStage !== oldStage) {
        await supabase.from("crm_deal_stage_history").insert({
          user_id: user!.id,
          org_id: orgId,
          deal_id: deal.id,
          from_stage: oldStage,
          to_stage: newStage,
        });
      }
      setEditing(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleCloseReasonConfirm = async (result: { close_reason: string; lost_to: string }) => {
    if (!deal || !pendingStage || !user) return;

    if (pendingStageSource === "edit") {
      // Coming from edit form save
      const { contact_id_edit, company_id_edit, ...rest } = editForm;
      const updates: Record<string, unknown> = {
        ...rest,
        stage: pendingStage,
        probability: STAGE_PROBABILITY[pendingStage] ?? 0,
        close_reason: result.close_reason,
        lost_to: result.lost_to,
        closed_at: new Date().toISOString(),
        contact_id: contact_id_edit || null,
        company_id: company_id_edit || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("crm_deals").update(updates).eq("id", deal.id);
      if (!error) {
        await supabase.from("crm_deal_stage_history").insert({
          user_id: user.id, org_id: orgId, deal_id: deal.id, from_stage: deal.stage, to_stage: pendingStage, notes: result.close_reason,
        });
        setEditing(false);
      }
    } else {
      // Coming from quick dropdown change
      const updates: Record<string, unknown> = {
        stage: pendingStage,
        probability: STAGE_PROBABILITY[pendingStage] ?? 0,
        close_reason: result.close_reason,
        lost_to: result.lost_to,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("crm_deals").update(updates).eq("id", deal.id);
      await supabase.from("crm_deal_stage_history").insert({
        user_id: user.id, org_id: orgId, deal_id: deal.id, from_stage: deal.stage, to_stage: pendingStage, notes: result.close_reason,
      });
    }

    setShowCloseModal(null);
    setPendingStage(null);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const handleDelete = async () => {
    if (!deal) return;
    await supabase.from("crm_deals").delete().eq("id", deal.id);
    window.dispatchEvent(new Event("workspace-updated"));
    router.push("/crm?tab=deals");
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const isClosed = deal?.stage === "won" || deal?.stage === "lost";

  if (loading) return <div className="crm-loading">Loading deal...</div>;
  if (!deal) return <div className="crm-empty">Deal not found.</div>;

  return (
    <div className="crm-detail-page">
      <button className="crm-back-btn" onClick={() => router.push("/crm?tab=deals")}>← Back</button>

      {/* Header */}
      <div className="crm-detail-header">
        <div className="crm-detail-header-main">
          <div>
            <h1 className="crm-detail-name">{deal.title}</h1>
            <div className="crm-detail-subtitle">
              <DealValue value={deal.value} currency={deal.currency} />
              {primaryContact && (
                <>
                  <span> · </span>
                  <span className="crm-clickable" style={{ color: "var(--color-primary)", cursor: "pointer" }} onClick={() => router.push(`/crm/contacts/${primaryContact.id}`)}>
                    {primaryContact.first_name} {primaryContact.last_name}
                  </span>
                </>
              )}
              {company && (
                <>
                  <span> · </span>
                  <span className="crm-clickable" style={{ color: "var(--color-primary)", cursor: "pointer" }} onClick={() => router.push(`/crm/companies/${company.id}`)}>
                    {company.name}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="crm-detail-actions">
            {/* Fix #4: Inline stage dropdown */}
            <select
              className="crm-stage-select"
              value={deal.stage}
              onChange={(e) => handleQuickStageChange(e.target.value as DealStage)}
            >
              {DEAL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <span className="crm-detail-prob">{deal.probability}%</span>
            <button className="btn btn-secondary btn-sm" onClick={handleEdit}>Edit</button>
            <button className="btn btn-secondary btn-sm crm-btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </div>
      </div>

      {/* Close Reason Modal */}
      {showCloseModal && (
        <CloseReasonModal
          stage={showCloseModal}
          onConfirm={handleCloseReasonConfirm}
          onCancel={() => { setShowCloseModal(null); setPendingStage(null); }}
        />
      )}

      {/* Edit form */}
      {editing && (
        <div className="crm-detail-section crm-detail-edit" style={{ marginBottom: 20 }}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="Title" value={editForm.title ?? ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            <input className="crm-input" placeholder="Value" type="number" value={editForm.value ?? ""} onChange={(e) => setEditForm({ ...editForm, value: parseFloat(e.target.value) || 0 })} />
            <select className="crm-input" value={editForm.stage ?? "lead"} onChange={(e) => setEditForm({ ...editForm, stage: e.target.value as DealStage, probability: STAGE_PROBABILITY[e.target.value] ?? editForm.probability })}>
              {DEAL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className="crm-input" placeholder="Probability" type="number" min="0" max="100" value={editForm.probability ?? ""} onChange={(e) => setEditForm({ ...editForm, probability: parseInt(e.target.value) || 0 })} />
            <input className="crm-input" type="date" value={editForm.expected_close_date ?? ""} onChange={(e) => setEditForm({ ...editForm, expected_close_date: e.target.value })} />
            <select className="crm-input" value={editForm.contact_id_edit ?? ""} onChange={(e) => setEditForm({ ...editForm, contact_id_edit: e.target.value })}>
              <option value="">No contact</option>
              {allContacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="crm-input" value={editForm.company_id_edit ?? ""} onChange={(e) => setEditForm({ ...editForm, company_id_edit: e.target.value })}>
              <option value="">No company</option>
              {allCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {(editForm.stage === "won" || editForm.stage === "lost") && (
            <div className="crm-form-grid" style={{ marginTop: 8 }}>
              <input className="crm-input" placeholder={editForm.stage === "won" ? "Win reason" : "Loss reason"} value={editForm.close_reason ?? ""} onChange={(e) => setEditForm({ ...editForm, close_reason: e.target.value })} />
              {editForm.stage === "lost" && (
                <input className="crm-input" placeholder="Lost to competitor" value={editForm.lost_to ?? ""} onChange={(e) => setEditForm({ ...editForm, lost_to: e.target.value })} />
              )}
            </div>
          )}
          <textarea className="crm-input crm-textarea" placeholder="Notes" value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
          <textarea className="crm-input crm-textarea" placeholder="Next steps" value={editForm.next_steps ?? ""} onChange={(e) => setEditForm({ ...editForm, next_steps: e.target.value })} rows={2} />
          <div className="crm-detail-edit-actions">
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="crm-detail-grid">
        {/* Deal Info */}
        <div className="crm-detail-section">
          <h3 className="crm-detail-section-title">Deal Info</h3>
          <div className="crm-detail-fields">
            <div className="crm-detail-field"><span className="crm-field-label">Stage</span><StatusBadge status={deal.stage} /></div>
            <div className="crm-detail-field"><span className="crm-field-label">Value</span><DealValue value={deal.value} currency={deal.currency} /></div>
            <div className="crm-detail-field"><span className="crm-field-label">Probability</span><span>{deal.probability}%</span></div>
            {deal.expected_close_date && <div className="crm-detail-field"><span className="crm-field-label">Expected Close</span><span>{fmt(deal.expected_close_date)}</span></div>}
            <div className="crm-detail-field"><span className="crm-field-label">Created</span><span>{fmt(deal.created_at)}</span></div>
          </div>
        </div>

        {/* Custom Fields */}
        <CustomFieldsSection
          tableName="crm_deals"
          metadata={(deal.metadata as Record<string, unknown>) || {}}
          entityId={deal.id}
          onUpdate={loadData}
        />

        {/* Close Info (only if won/lost) */}
        {isClosed && (
          <div className="crm-detail-section crm-close-info">
            <h3 className="crm-detail-section-title">
              {deal.stage === "won" ? "Deal Won" : "Deal Lost"}
            </h3>
            <div className="crm-detail-fields">
              {deal.closed_at && (
                <div className="crm-detail-field"><span className="crm-field-label">Closed Date</span><span>{fmt(deal.closed_at)}</span></div>
              )}
              {deal.close_reason && (
                <div className="crm-detail-field"><span className="crm-field-label">Reason</span><span>{deal.close_reason}</span></div>
              )}
              {deal.stage === "lost" && deal.lost_to && (
                <div className="crm-detail-field"><span className="crm-field-label">Lost To</span><span>{deal.lost_to}</span></div>
              )}
            </div>
          </div>
        )}

        {/* Company */}
        {company && (
          <div className="crm-detail-section">
            <h3 className="crm-detail-section-title">Company</h3>
            <div className="crm-company-card crm-clickable" onClick={() => router.push(`/crm/companies/${company.id}`)}>
              <div className="crm-card-title">{company.name}</div>
              {company.industry && <div className="crm-card-meta">{company.industry}</div>}
              {company.employees && <div className="crm-detail-meta">{company.employees.toLocaleString()} employees</div>}
              {company.annual_revenue && <div className="crm-detail-meta">{formatCurrency(company.annual_revenue)} revenue</div>}
            </div>
          </div>
        )}

        {/* Line Items / Products */}
        <div className="crm-detail-section" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 className="crm-detail-section-title" style={{ marginBottom: 0 }}>
              Products / Line Items ({lineItems.length})
            </h3>
            <button className="btn btn-sm" onClick={() => setShowLineItemForm(!showLineItemForm)}>
              {showLineItemForm ? "Cancel" : "+ Line Item"}
            </button>
          </div>

          {showLineItemForm && (
            <form className="crm-inline-form" onSubmit={handleAddLineItem} style={{ marginBottom: 12 }}>
              <div className="crm-form-grid">
                <select
                  className="crm-input"
                  value={lineItemForm.product_id}
                  onChange={(e) => {
                    const p = products.find(pr => pr.id === e.target.value);
                    setLineItemForm({
                      ...lineItemForm,
                      product_id: e.target.value,
                      unit_price: p ? String(p.unit_price) : lineItemForm.unit_price,
                    });
                  }}
                >
                  <option value="">Select product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""} — {formatCurrency(p.unit_price)}</option>
                  ))}
                </select>
                <input className="crm-input" placeholder="Qty" type="number" min="1" value={lineItemForm.quantity} onChange={(e) => setLineItemForm({ ...lineItemForm, quantity: e.target.value })} style={{ maxWidth: 80 }} />
                <input className="crm-input" placeholder="Unit Price ($)" type="number" step="0.01" value={lineItemForm.unit_price} onChange={(e) => setLineItemForm({ ...lineItemForm, unit_price: e.target.value })} />
                <input className="crm-input" placeholder="Discount %" type="number" step="0.1" min="0" max="100" value={lineItemForm.discount} onChange={(e) => setLineItemForm({ ...lineItemForm, discount: e.target.value })} style={{ maxWidth: 100 }} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Add</button>
            </form>
          )}

          {lineItems.length === 0 ? (
            <div className="crm-detail-empty">No line items yet. Add products to this deal.</div>
          ) : (
            <>
              <div className="crm-table-wrap">
                <table className="crm-table crm-line-items-table">
                  <thead>
                    <tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Total</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li) => (
                      <tr key={li.id} className="crm-table-row">
                        <td className="crm-cell-name">{li.product_name}</td>
                        <td>{li.quantity}</td>
                        <td>{formatCurrency(li.unit_price)}</td>
                        <td>{li.discount > 0 ? `${li.discount}%` : "\u2014"}</td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(li.total)}</td>
                        <td>
                          <button className="btn btn-sm crm-btn-danger" onClick={() => handleDeleteLineItem(li.id)} style={{ padding: "2px 8px", fontSize: 11 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ textAlign: "right", marginTop: 8, fontSize: 15, fontWeight: 700 }}>
                Deal Total: {formatCurrency(lineItemTotal)}
              </div>
            </>
          )}
        </div>

        {/* Notes & Next Steps */}
        <div className="crm-detail-section">
          {deal.notes && (
            <>
              <h3 className="crm-detail-section-title">Notes</h3>
              <div className="crm-detail-notes" style={{ marginBottom: 16 }}>{deal.notes}</div>
            </>
          )}
          {deal.next_steps && (
            <>
              <h3 className="crm-detail-section-title">Next Steps</h3>
              <div className="crm-detail-notes crm-detail-next-steps">{deal.next_steps}</div>
            </>
          )}
        </div>

        {/* Fix #3: Contacts table — all contacts at this company */}
        <div className="crm-detail-section" style={{ gridColumn: "1 / -1" }}>
          <h3 className="crm-detail-section-title">
            Contacts{company ? ` at ${company.name}` : ""} ({companyContacts.length})
          </h3>
          {companyContacts.length === 0 ? (
            primaryContact ? (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    <tr className="crm-table-row crm-clickable" onClick={() => router.push(`/crm/contacts/${primaryContact.id}`)}>
                      <td className="crm-cell-name">{primaryContact.first_name} {primaryContact.last_name}</td>
                      <td>{primaryContact.title || "\u2014"}</td>
                      <td>{primaryContact.email || "\u2014"}</td>
                      <td>{primaryContact.phone || "\u2014"}</td>
                      <td><StatusBadge status={primaryContact.status} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="crm-detail-empty">No contacts linked to this deal.</div>
            )
          ) : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead>
                  <tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {companyContacts.map(c => (
                    <tr
                      key={c.id}
                      className={`crm-table-row crm-clickable ${c.id === deal.contact_id ? "crm-row-primary" : ""}`}
                      onClick={() => router.push(`/crm/contacts/${c.id}`)}
                    >
                      <td className="crm-cell-name">
                        {c.first_name} {c.last_name}
                        {c.id === deal.contact_id && <span style={{ fontSize: 10, color: "var(--color-primary)", marginLeft: 6 }}>Primary</span>}
                      </td>
                      <td>{c.title || "\u2014"}</td>
                      <td>{c.email || "\u2014"}</td>
                      <td>{c.phone || "\u2014"}</td>
                      <td><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stage History */}
        <div className="crm-detail-section" style={{ gridColumn: "1 / -1" }}>
          <h3 className="crm-detail-section-title">Stage History ({stageHistory.length})</h3>
          {stageHistory.length === 0 ? (
            <div className="crm-detail-empty">No stage changes recorded yet.</div>
          ) : (
            <div className="crm-stage-history">
              {stageHistory.map((h) => (
                <div key={h.id} className="crm-stage-history-item">
                  <div className="crm-stage-history-dot" />
                  <div className="crm-stage-history-content">
                    <div className="crm-stage-history-change">
                      {h.from_stage ? (
                        <>
                          <StatusBadge status={h.from_stage} />
                          <span className="crm-stage-history-arrow">→</span>
                          <StatusBadge status={h.to_stage} />
                        </>
                      ) : (
                        <>
                          <span>Created as</span>
                          <StatusBadge status={h.to_stage} />
                        </>
                      )}
                    </div>
                    {h.notes && <div className="crm-stage-history-notes">{h.notes}</div>}
                    <div className="crm-stage-history-date">{fmt(h.changed_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activities */}
        <div className="crm-detail-section" style={{ gridColumn: "1 / -1" }}>
          <h3 className="crm-detail-section-title">Activities ({activities.length})</h3>
          {activities.length === 0 ? (
            <div className="crm-detail-empty">No activities linked to this deal.</div>
          ) : (
            <div className="crm-detail-list">
              {activities.map(a => (
                <div key={a.id} className="crm-activity-item crm-activity-compact">
                  <ActivityIcon type={a.type} />
                  <div className="crm-activity-body">
                    <span className="crm-activity-type"><ActivityLabel type={a.type} /></span>
                    <span className="crm-activity-subject">{a.subject}</span>
                    {a.description && <span className="crm-detail-meta" style={{ display: "block", marginTop: 2 }}>{a.description.slice(0, 120)}{a.description.length > 120 ? "..." : ""}</span>}
                    <span className="crm-activity-date">{fmt(a.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
