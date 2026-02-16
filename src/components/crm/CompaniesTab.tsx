"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { SizeBadge, StatusBadge } from "./shared";
import type { CrmCompany, CompanySize, DealStage } from "@/lib/types/database";

const SIZE_OPTIONS: CompanySize[] = ["startup", "small", "medium", "large", "enterprise"];

interface CompanyDeal {
  id: string;
  title: string;
  value: number;
  stage: DealStage;
  company_id: string;
}

interface CompanyWithCounts extends CrmCompany {
  contactCount: number;
  dealCount: number;
  deals: CompanyDeal[];
}

export default function CompaniesTab() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [companies, setCompanies] = useState<CompanyWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    industry: "",
    size: "" as CompanySize,
    website: "",
    phone: "",
    address: "",
    description: "",
    annual_revenue: "",
    employees: "",
    sector: "",
    account_owner: "",
    billing_address: "",
    shipping_address: "",
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [companiesRes, contactsRes, dealsRes] = await Promise.all([
      supabase.from("crm_companies").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, company_id"),
      supabase.from("crm_deals").select("id, title, value, stage, company_id"),
    ]);

    const contactCounts: Record<string, number> = {};
    const dealsByCompany: Record<string, CompanyDeal[]> = {};

    if (contactsRes.data) {
      for (const c of contactsRes.data) {
        if (c.company_id) contactCounts[c.company_id] = (contactCounts[c.company_id] ?? 0) + 1;
      }
    }
    if (dealsRes.data) {
      for (const d of dealsRes.data) {
        if (d.company_id) {
          if (!dealsByCompany[d.company_id]) dealsByCompany[d.company_id] = [];
          dealsByCompany[d.company_id].push(d as CompanyDeal);
        }
      }
    }

    if (companiesRes.data) {
      setCompanies(
        (companiesRes.data as CrmCompany[]).map((c) => ({
          ...c,
          contactCount: contactCounts[c.id] ?? 0,
          dealCount: dealsByCompany[c.id]?.length ?? 0,
          deals: dealsByCompany[c.id] ?? [],
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
    if (!user || !form.name.trim()) return;

    const { error } = await supabase.from("crm_companies").insert({
      user_id: user.id,
      name: form.name.trim(),
      domain: form.domain.trim(),
      industry: form.industry.trim(),
      size: form.size,
      website: form.website.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      description: form.description.trim(),
      annual_revenue: form.annual_revenue ? parseFloat(form.annual_revenue) : null,
      employees: form.employees ? parseInt(form.employees) : null,
      sector: form.sector.trim(),
      account_owner: form.account_owner.trim(),
      billing_address: form.billing_address.trim(),
      shipping_address: form.shipping_address.trim(),
    });

    if (!error) {
      setForm({ name: "", domain: "", industry: "", size: "", website: "", phone: "", address: "", description: "", annual_revenue: "", employees: "", sector: "", account_owner: "", billing_address: "", shipping_address: "" });
      setShowForm(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("crm_companies").delete().eq("id", id);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const filtered = companies.filter((c) => {
    if (!search) return true;
    return `${c.name} ${c.industry} ${c.domain}`.toLowerCase().includes(search.toLowerCase());
  });

  if (loading) return <div className="crm-loading">Loading companies...</div>;

  return (
    <div className="crm-tab-content">
      <div className="crm-toolbar">
        <input
          type="text"
          className="crm-search-input"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="crm-view-toggle">
          <button
            className={`crm-view-btn ${viewMode === "cards" ? "crm-view-btn-active" : ""}`}
            onClick={() => setViewMode("cards")}
          >
            Cards
          </button>
          <button
            className={`crm-view-btn ${viewMode === "list" ? "crm-view-btn-active" : ""}`}
            onClick={() => setViewMode("list")}
          >
            List
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Company"}
        </button>
      </div>

      {showForm && (
        <form className="crm-inline-form" onSubmit={handleSubmit}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="Company name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="crm-input" placeholder="Domain (e.g. acme.com)" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
            <input className="crm-input" placeholder="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            <select className="crm-input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as CompanySize })}>
              <option value="">Size</option>
              {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <input className="crm-input" placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <input className="crm-input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="crm-input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input className="crm-input" placeholder="Annual Revenue ($)" type="number" value={form.annual_revenue} onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} />
            <input className="crm-input" placeholder="Employees" type="number" value={form.employees} onChange={(e) => setForm({ ...form, employees: e.target.value })} />
            <input className="crm-input" placeholder="Sector" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />
            <input className="crm-input" placeholder="Account Owner" value={form.account_owner} onChange={(e) => setForm({ ...form, account_owner: e.target.value })} />
          </div>
          <textarea
            className="crm-input crm-textarea"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
            Add Company
          </button>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="crm-empty">
          {companies.length === 0
            ? "No companies yet. Add your first company or ask AI to create one."
            : "No companies match your search."}
        </div>
      ) : viewMode === "cards" ? (
        <div className="crm-card-grid">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="crm-card crm-clickable"
              onClick={() => router.push(`/crm/companies/${c.id}`)}
            >
              <div className="crm-card-header">
                <h3 className="crm-card-title">{c.name}</h3>
                <button
                  className="crm-action-btn crm-action-delete"
                  title="Delete"
                  onClick={(e) => handleDelete(c.id, e)}
                >
                  ×
                </button>
              </div>
              {c.industry && <div className="crm-card-meta">{c.industry}</div>}
              <div className="crm-card-stats">
                <SizeBadge size={c.size} />
                <span className="crm-card-stat">{c.contactCount} contacts</span>
                <span className="crm-card-stat">{c.dealCount} deals</span>
              </div>
              {c.deals.length > 0 && (
                <div className="crm-card-deals">
                  {c.deals.map((d) => (
                    <StatusBadge key={d.id} status={d.stage} />
                  ))}
                </div>
              )}
              {c.description && (
                <div className="crm-card-desc">{c.description.slice(0, 120)}{c.description.length > 120 ? "..." : ""}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Size</th>
                <th>Contacts</th>
                <th>Deals</th>
                <th>Deal Stages</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="crm-table-row crm-clickable"
                  onClick={() => router.push(`/crm/companies/${c.id}`)}
                >
                  <td className="crm-cell-name">{c.name}</td>
                  <td>{c.industry || "—"}</td>
                  <td>{c.size ? <SizeBadge size={c.size} /> : "—"}</td>
                  <td>{c.contactCount}</td>
                  <td>{c.dealCount}</td>
                  <td>
                    <div className="crm-cell-stages">
                      {c.deals.length > 0
                        ? c.deals.map((d) => <StatusBadge key={d.id} status={d.stage} />)
                        : "—"}
                    </div>
                  </td>
                  <td>
                    <button
                      className="crm-action-btn crm-action-delete"
                      title="Delete"
                      onClick={(e) => handleDelete(c.id, e)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
