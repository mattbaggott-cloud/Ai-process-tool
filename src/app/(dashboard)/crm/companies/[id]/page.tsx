"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import {
  SizeBadge, StatusBadge, DealValue, ActivityIcon, ActivityLabel,
  AssetStatusBadge, formatCurrency, DEAL_STAGES,
} from "@/components/crm/shared";
import CustomFieldsSection from "@/components/crm/CustomFieldsSection";
import type { CrmCompany, CrmContact, CrmDeal, CrmActivity, CrmCompanyAsset, CrmProduct, CompanySize } from "@/lib/types/database";

const SIZE_OPTIONS: CompanySize[] = ["", "startup", "small", "medium", "large", "enterprise"];
type DetailTab = "overview" | "contacts" | "opportunities" | "activities" | "assets";
type OpptyFilter = "all" | "active" | "won" | "lost";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();

  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [assets, setAssets] = useState<CrmCompanyAsset[]>([]);
  const [products, setProducts] = useState<CrmProduct[]>([]);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetForm, setAssetForm] = useState({ product_id: "", quantity: "1", purchase_date: "", renewal_date: "", annual_value: "", status: "active", notes: "" });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CrmCompany>>({});
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [opptyFilter, setOpptyFilter] = useState<OpptyFilter>("all");

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);

    const [companyRes, contactsRes, dealsRes, activitiesRes, assetsRes, productsRes] = await Promise.all([
      supabase.from("crm_companies").select("*").eq("id", id).single(),
      supabase.from("crm_contacts").select("*").eq("company_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_deals").select("*").eq("company_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_activities").select("*").eq("company_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_company_assets").select("*").eq("company_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_products").select("*").eq("is_active", true).order("name"),
    ]);

    if (companyRes.data) setCompany(companyRes.data as CrmCompany);
    if (contactsRes.data) setContacts(contactsRes.data as CrmContact[]);
    if (dealsRes.data) setDeals(dealsRes.data as CrmDeal[]);
    if (activitiesRes.data) setActivities(activitiesRes.data as CrmActivity[]);
    if (assetsRes.data) setAssets(assetsRes.data as CrmCompanyAsset[]);
    if (productsRes.data) setProducts(productsRes.data as CrmProduct[]);
    setLoading(false);
  }, [user?.id, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  const handleEdit = () => {
    if (!company) return;
    setEditForm({
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      size: company.size,
      website: company.website,
      phone: company.phone,
      address: company.address,
      description: company.description,
      annual_revenue: company.annual_revenue,
      employees: company.employees,
      sic_code: company.sic_code,
      sector: company.sector,
      account_owner: company.account_owner,
      billing_address: company.billing_address,
      shipping_address: company.shipping_address,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!company) return;
    const { error } = await supabase
      .from("crm_companies")
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq("id", company.id);
    if (!error) {
      setEditing(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleDelete = async () => {
    if (!company) return;
    await supabase.from("crm_companies").delete().eq("id", company.id);
    window.dispatchEvent(new Event("workspace-updated"));
    router.push("/crm?tab=companies");
  };

  /* ── Asset management ── */
  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !company) return;
    const product = products.find(p => p.id === assetForm.product_id);
    await supabase.from("crm_company_assets").insert({
      user_id: user.id,
      company_id: company.id,
      product_id: assetForm.product_id || null,
      product_name: product?.name || "Custom Product",
      quantity: parseInt(assetForm.quantity) || 1,
      purchase_date: assetForm.purchase_date,
      renewal_date: assetForm.renewal_date,
      annual_value: parseFloat(assetForm.annual_value) || 0,
      status: assetForm.status,
      notes: assetForm.notes.trim(),
    });
    setAssetForm({ product_id: "", quantity: "1", purchase_date: "", renewal_date: "", annual_value: "", status: "active", notes: "" });
    setShowAssetForm(false);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const handleDeleteAsset = async (assetId: string) => {
    await supabase.from("crm_company_assets").delete().eq("id", assetId);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const installedBaseValue = assets.filter(a => a.status === "active").reduce((s, a) => s + (a.annual_value || 0), 0);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  /* Computed stats */
  const activeDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const wonDeals = deals.filter((d) => d.stage === "won");
  const lostDeals = deals.filter((d) => d.stage === "lost");
  const pipelineValue = activeDeals.reduce((s, d) => s + Number(d.value), 0);
  const wonValue = wonDeals.reduce((s, d) => s + Number(d.value), 0);

  const filteredDeals =
    opptyFilter === "active" ? activeDeals
    : opptyFilter === "won" ? wonDeals
    : opptyFilter === "lost" ? lostDeals
    : deals;

  if (loading) return <div className="crm-loading">Loading company...</div>;
  if (!company) return <div className="crm-empty">Company not found.</div>;

  return (
    <div className="crm-detail-page">
      {/* Back */}
      <button className="crm-back-btn" onClick={() => router.push("/crm?tab=companies")}>← Back</button>

      {/* Header */}
      <div className="crm-detail-header">
        <div className="crm-detail-header-main">
          <div>
            <h1 className="crm-detail-name">{company.name}</h1>
            {company.industry && <span className="crm-detail-subtitle">{company.industry}</span>}
          </div>
          <div className="crm-detail-actions">
            <SizeBadge size={company.size} />
            <button className="btn btn-secondary btn-sm" onClick={handleEdit}>Edit</button>
            <button className="btn btn-secondary btn-sm crm-btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="crm-detail-metrics-bar">
          {company.account_owner && (
            <div className="crm-detail-metric-item">
              <span className="crm-detail-metric-label">Account Owner</span>
              <span className="crm-detail-metric-value">{company.account_owner}</span>
            </div>
          )}
          {company.annual_revenue != null && (
            <div className="crm-detail-metric-item">
              <span className="crm-detail-metric-label">Annual Revenue</span>
              <span className="crm-detail-metric-value">{formatCurrency(company.annual_revenue)}</span>
            </div>
          )}
          {company.employees != null && (
            <div className="crm-detail-metric-item">
              <span className="crm-detail-metric-label">Employees</span>
              <span className="crm-detail-metric-value">{company.employees.toLocaleString()}</span>
            </div>
          )}
          {company.website && (
            <div className="crm-detail-metric-item">
              <span className="crm-detail-metric-label">Website</span>
              <span className="crm-detail-metric-value">
                <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer">
                  {company.website}
                </a>
              </span>
            </div>
          )}
          {company.sector && (
            <div className="crm-detail-metric-item">
              <span className="crm-detail-metric-label">Sector</span>
              <span className="crm-detail-metric-value">{company.sector}</span>
            </div>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="crm-detail-section crm-detail-edit" style={{ marginBottom: 20 }}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="Name" value={editForm.name ?? ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <input className="crm-input" placeholder="Domain" value={editForm.domain ?? ""} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} />
            <input className="crm-input" placeholder="Industry" value={editForm.industry ?? ""} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} />
            <select className="crm-input" value={editForm.size ?? ""} onChange={(e) => setEditForm({ ...editForm, size: e.target.value as CompanySize })}>
              {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : "No size"}</option>)}
            </select>
            <input className="crm-input" placeholder="Website" value={editForm.website ?? ""} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
            <input className="crm-input" placeholder="Phone" value={editForm.phone ?? ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <input className="crm-input" placeholder="Sector" value={editForm.sector ?? ""} onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })} />
            <input className="crm-input" placeholder="Account Owner" value={editForm.account_owner ?? ""} onChange={(e) => setEditForm({ ...editForm, account_owner: e.target.value })} />
            <input className="crm-input" type="number" placeholder="Annual Revenue" value={editForm.annual_revenue ?? ""} onChange={(e) => setEditForm({ ...editForm, annual_revenue: e.target.value ? Number(e.target.value) : null })} />
            <input className="crm-input" type="number" placeholder="Employees" value={editForm.employees ?? ""} onChange={(e) => setEditForm({ ...editForm, employees: e.target.value ? Number(e.target.value) : null })} />
            <input className="crm-input" placeholder="SIC Code" value={editForm.sic_code ?? ""} onChange={(e) => setEditForm({ ...editForm, sic_code: e.target.value })} />
          </div>
          <input className="crm-input" placeholder="Address" value={editForm.address ?? ""} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} style={{ marginTop: 8 }} />
          <textarea className="crm-input crm-textarea" placeholder="Billing Address" value={editForm.billing_address ?? ""} onChange={(e) => setEditForm({ ...editForm, billing_address: e.target.value })} rows={2} />
          <textarea className="crm-input crm-textarea" placeholder="Shipping Address" value={editForm.shipping_address ?? ""} onChange={(e) => setEditForm({ ...editForm, shipping_address: e.target.value })} rows={2} />
          <textarea className="crm-input crm-textarea" placeholder="Description" value={editForm.description ?? ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} />
          <div className="crm-detail-edit-actions">
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="crm-detail-tabs">
        {(["overview", "contacts", "opportunities", "activities", "assets"] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            className={`crm-detail-tab ${activeTab === tab ? "crm-detail-tab-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "overview" ? "Overview"
              : tab === "contacts" ? `Contacts (${contacts.length})`
              : tab === "opportunities" ? `Opportunities (${deals.length})`
              : tab === "activities" ? `Activities (${activities.length})`
              : `Assets (${assets.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <>
          {/* Quick stats */}
          <div className="crm-quick-stats">
            <div className="crm-quick-stat">
              <div className="crm-quick-stat-value">{contacts.length}</div>
              <div className="crm-quick-stat-label">Contacts</div>
            </div>
            <div className="crm-quick-stat">
              <div className="crm-quick-stat-value">{deals.length}</div>
              <div className="crm-quick-stat-label">Total Deals</div>
            </div>
            <div className="crm-quick-stat">
              <div className="crm-quick-stat-value">{formatCurrency(pipelineValue)}</div>
              <div className="crm-quick-stat-label">Open Pipeline</div>
            </div>
            <div className="crm-quick-stat">
              <div className="crm-quick-stat-value">{formatCurrency(wonValue)}</div>
              <div className="crm-quick-stat-label">Total Won</div>
            </div>
          </div>

          {/* Company Info */}
          <div className="crm-detail-section">
            <h3 className="crm-detail-section-title">Company Info</h3>
            <div className="crm-detail-fields">
              {company.domain && <div className="crm-detail-field"><span className="crm-field-label">Domain</span><span>{company.domain}</span></div>}
              {company.website && <div className="crm-detail-field"><span className="crm-field-label">Website</span><a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer">{company.website}</a></div>}
              {company.phone && <div className="crm-detail-field"><span className="crm-field-label">Phone</span><span>{company.phone}</span></div>}
              {company.address && <div className="crm-detail-field"><span className="crm-field-label">Address</span><span>{company.address}</span></div>}
              {company.billing_address && <div className="crm-detail-field"><span className="crm-field-label">Billing Address</span><span>{company.billing_address}</span></div>}
              {company.shipping_address && <div className="crm-detail-field"><span className="crm-field-label">Shipping Address</span><span>{company.shipping_address}</span></div>}
              {company.sic_code && <div className="crm-detail-field"><span className="crm-field-label">SIC Code</span><span>{company.sic_code}</span></div>}
              {company.sector && <div className="crm-detail-field"><span className="crm-field-label">Sector</span><span>{company.sector}</span></div>}
              <div className="crm-detail-field"><span className="crm-field-label">Created</span><span>{fmt(company.created_at)}</span></div>
            </div>
            {company.description && <div className="crm-detail-notes" style={{ marginTop: 12 }}>{company.description}</div>}
          </div>

          {/* Custom Fields */}
          <CustomFieldsSection
            tableName="crm_companies"
            metadata={(company.metadata as Record<string, unknown>) || {}}
            entityId={company.id}
            onUpdate={loadData}
          />
        </>
      )}

      {activeTab === "contacts" && (
        <div className="crm-detail-section">
          <h3 className="crm-detail-section-title">Contacts ({contacts.length})</h3>
          {contacts.length === 0 ? (
            <div className="crm-detail-empty">No contacts at this company.</div>
          ) : (
            <table className="crm-oppty-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/crm/contacts/${c.id}`)}>
                    <td className="crm-oppty-name">{c.first_name} {c.last_name}</td>
                    <td>{c.title || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "opportunities" && (
        <div className="crm-detail-section">
          <h3 className="crm-detail-section-title">Opportunities ({deals.length})</h3>

          <div className="crm-deal-filter-tabs">
            {(["all", "active", "won", "lost"] as OpptyFilter[]).map((f) => (
              <button
                key={f}
                className={`crm-deal-filter-tab ${opptyFilter === f ? "crm-deal-filter-tab-active" : ""}`}
                onClick={() => setOpptyFilter(f)}
              >
                {f === "all" ? "All" : f === "active" ? "Active" : f === "won" ? "Won" : "Lost"}
              </button>
            ))}
          </div>

          {filteredDeals.length === 0 ? (
            <div className="crm-detail-empty">No {opptyFilter === "all" ? "" : opptyFilter} deals.</div>
          ) : (
            <table className="crm-oppty-table">
              <thead>
                <tr>
                  <th>Deal Name</th>
                  <th>Stage</th>
                  <th>Amount</th>
                  <th>Close Date</th>
                  <th>Probability</th>
                  {opptyFilter === "lost" && <th>Reason</th>}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((d) => (
                  <tr key={d.id} onClick={() => router.push(`/crm/deals/${d.id}`)}>
                    <td className="crm-oppty-name">{d.title}</td>
                    <td><StatusBadge status={d.stage} /></td>
                    <td className="crm-oppty-value"><DealValue value={d.value} /></td>
                    <td>{d.closed_at ? fmt(d.closed_at) : d.expected_close_date ? fmt(d.expected_close_date) : "—"}</td>
                    <td>{d.probability}%</td>
                    {opptyFilter === "lost" && <td>{d.close_reason || "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "activities" && (
        <div className="crm-detail-section">
          <h3 className="crm-detail-section-title">Activities ({activities.length})</h3>
          {activities.length === 0 ? (
            <div className="crm-detail-empty">No activities for this company.</div>
          ) : (
            <div className="crm-detail-list">
              {activities.map((a) => (
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
      )}

      {activeTab === "assets" && (
        <div className="crm-detail-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 className="crm-detail-section-title" style={{ marginBottom: 0 }}>
              Installed Base / Assets ({assets.length})
            </h3>
            <button className="btn btn-sm" onClick={() => setShowAssetForm(!showAssetForm)}>
              {showAssetForm ? "Cancel" : "+ Asset"}
            </button>
          </div>

          {installedBaseValue > 0 && (
            <div style={{ fontSize: 14, fontWeight: 600, color: "#059669", marginBottom: 12 }}>
              Total Active Asset Value: {formatCurrency(installedBaseValue)}
            </div>
          )}

          {showAssetForm && (
            <form className="crm-inline-form" onSubmit={handleAddAsset} style={{ marginBottom: 12 }}>
              <div className="crm-form-grid">
                <select className="crm-input" value={assetForm.product_id} onChange={(e) => setAssetForm({ ...assetForm, product_id: e.target.value })}>
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                </select>
                <input className="crm-input" placeholder="Qty" type="number" min="1" value={assetForm.quantity} onChange={(e) => setAssetForm({ ...assetForm, quantity: e.target.value })} style={{ maxWidth: 80 }} />
                <input className="crm-input" type="date" placeholder="Purchase Date" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} />
                <input className="crm-input" type="date" placeholder="Renewal Date" value={assetForm.renewal_date} onChange={(e) => setAssetForm({ ...assetForm, renewal_date: e.target.value })} />
                <input className="crm-input" placeholder="Annual Value ($)" type="number" step="0.01" value={assetForm.annual_value} onChange={(e) => setAssetForm({ ...assetForm, annual_value: e.target.value })} />
                <select className="crm-input" value={assetForm.status} onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Add Asset</button>
            </form>
          )}

          {assets.length === 0 ? (
            <div className="crm-detail-empty">No assets recorded for this company.</div>
          ) : (
            <table className="crm-oppty-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Purchase Date</th>
                  <th>Renewal Date</th>
                  <th>Annual Value</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="crm-oppty-name">{a.product_name}</td>
                    <td>{a.quantity}</td>
                    <td>{a.purchase_date ? fmt(a.purchase_date) : "\u2014"}</td>
                    <td>{a.renewal_date ? fmt(a.renewal_date) : "\u2014"}</td>
                    <td>{formatCurrency(a.annual_value)}</td>
                    <td><AssetStatusBadge status={a.status} /></td>
                    <td>
                      <button className="btn btn-sm crm-btn-danger" onClick={() => handleDeleteAsset(a.id)} style={{ padding: "2px 8px", fontSize: 11 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
