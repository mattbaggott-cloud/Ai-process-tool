"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "./shared";
import type { CrmProduct } from "@/lib/types/database";

type ProductFilter = "active" | "all";

export default function ProductsTab() {
  const { user } = useAuth();
  const supabase = createClient();

  const [products, setProducts] = useState<CrmProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProductFilter>("active");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "",
    unit_price: "",
    description: "",
  });

  const loadProducts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase.from("crm_products").select("*").order("created_at", { ascending: false });
    if (filter === "active") query = query.eq("is_active", true);
    const { data } = await query;
    if (data) setProducts(data as CrmProduct[]);
    setLoading(false);
  }, [user?.id, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    const handler = () => loadProducts();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadProducts]);

  const resetForm = () => {
    setForm({ name: "", sku: "", category: "", unit_price: "", description: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.name.trim()) return;

    const payload = {
      user_id: user.id,
      name: form.name.trim(),
      sku: form.sku.trim(),
      category: form.category.trim(),
      unit_price: parseFloat(form.unit_price) || 0,
      description: form.description.trim(),
    };

    if (editingId) {
      await supabase.from("crm_products").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editingId);
    } else {
      await supabase.from("crm_products").insert(payload);
    }

    resetForm();
    loadProducts();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const handleEdit = (p: CrmProduct) => {
    setForm({
      name: p.name,
      sku: p.sku,
      category: p.category,
      unit_price: String(p.unit_price || ""),
      description: p.description,
    });
    setEditingId(p.id);
    setShowForm(true);
  };

  const handleToggleActive = async (p: CrmProduct) => {
    await supabase.from("crm_products").update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq("id", p.id);
    loadProducts();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  });

  if (loading) return <div className="crm-loading">Loading products...</div>;

  return (
    <div className="crm-tab-content">
      <div className="crm-toolbar">
        <input
          className="crm-search-input"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="crm-deal-filter-tabs">
          <button
            className={`crm-deal-filter-tab ${filter === "active" ? "crm-deal-filter-tab-active" : ""}`}
            onClick={() => setFilter("active")}
          >
            Active
          </button>
          <button
            className={`crm-deal-filter-tab ${filter === "all" ? "crm-deal-filter-tab-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { if (showForm && !editingId) { resetForm(); } else { resetForm(); setShowForm(true); } }}>
          {showForm && !editingId ? "Cancel" : "+ Product"}
        </button>
      </div>

      {showForm && (
        <form className="crm-inline-form" onSubmit={handleSubmit}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="Product name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="crm-input" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <input className="crm-input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <input className="crm-input" placeholder="Unit Price ($)" type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
          </div>
          <textarea className="crm-input crm-textarea" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">{editingId ? "Update" : "Add Product"}</button>
            {editingId && <button type="button" className="btn btn-sm" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="crm-empty">
          {products.length === 0 ? "No products yet. Add your first product or ask AI to create one." : "No matching products."}
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Unit Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="crm-table-row">
                  <td className="crm-cell-name">{p.name}</td>
                  <td>{p.sku || "\u2014"}</td>
                  <td>{p.category || "\u2014"}</td>
                  <td>{formatCurrency(p.unit_price)}</td>
                  <td>
                    <span
                      className="crm-status-badge"
                      style={{
                        backgroundColor: p.is_active ? "#05966914" : "#6b728014",
                        color: p.is_active ? "#059669" : "#6b7280",
                        borderColor: p.is_active ? "#05966930" : "#6b728030",
                      }}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-sm" onClick={() => handleEdit(p)}>Edit</button>
                      <button className="btn btn-sm" onClick={() => handleToggleActive(p)}>
                        {p.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
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
