"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "./shared";
import type { CrmContact, CrmCompany, ContactStatus, ContactSource } from "@/lib/types/database";

interface ContactRow extends CrmContact {
  company_name?: string;
  last_touch?: string;
}

const STATUS_OPTIONS: ContactStatus[] = ["lead", "active", "inactive", "churned"];
const SOURCE_OPTIONS: ContactSource[] = ["manual", "import", "ai", "referral"];

export default function ContactsTab() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    title: "",
    company_id: "",
    status: "lead" as ContactStatus,
    source: "manual" as ContactSource,
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [contactsRes, companiesRes, activitiesRes] = await Promise.all([
      supabase.from("crm_contacts").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_companies").select("*").order("name"),
      supabase.from("crm_activities").select("contact_id, created_at").order("created_at", { ascending: false }),
    ]);

    const companyMap: Record<string, string> = {};
    if (companiesRes.data) {
      setCompanies(companiesRes.data as CrmCompany[]);
      for (const c of companiesRes.data) companyMap[c.id] = c.name;
    }

    // Build last-touch map (most recent activity per contact)
    const lastTouchMap: Record<string, string> = {};
    if (activitiesRes.data) {
      for (const a of activitiesRes.data) {
        if (a.contact_id && !lastTouchMap[a.contact_id]) {
          lastTouchMap[a.contact_id] = a.created_at;
        }
      }
    }

    if (contactsRes.data) {
      setContacts(
        (contactsRes.data as CrmContact[]).map((c) => ({
          ...c,
          company_name: c.company_id ? companyMap[c.company_id] ?? "" : "",
          last_touch: lastTouchMap[c.id] ?? "",
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
    if (!user || !form.first_name.trim()) return;

    const { error } = await supabase.from("crm_contacts").insert({
      user_id: user.id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      title: form.title.trim(),
      company_id: form.company_id || null,
      status: form.status,
      source: form.source,
    });

    if (!error) {
      setForm({ first_name: "", last_name: "", email: "", phone: "", title: "", company_id: "", status: "lead", source: "manual" });
      setShowForm(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("crm_contacts").delete().eq("id", id);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* Filtering */
  const filtered = contacts.filter((c) => {
    const matchesSearch =
      !search ||
      `${c.first_name} ${c.last_name} ${c.email} ${c.company_name}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !filterStatus || c.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) return <div className="crm-loading">Loading contacts...</div>;

  return (
    <div className="crm-tab-content">
      {/* Toolbar */}
      <div className="crm-toolbar">
        <input
          type="text"
          className="crm-search-input"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="crm-filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
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
          {showForm ? "Cancel" : "+ Contact"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form className="crm-inline-form" onSubmit={handleSubmit}>
          <div className="crm-form-grid">
            <input
              className="crm-input"
              placeholder="First name *"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
            />
            <input
              className="crm-input"
              placeholder="Last name"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
            <input
              className="crm-input"
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className="crm-input"
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              className="crm-input"
              placeholder="Job title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <select
              className="crm-input"
              value={form.company_id}
              onChange={(e) => setForm({ ...form, company_id: e.target.value })}
            >
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              className="crm-input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ContactStatus })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select
              className="crm-input"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as ContactSource })}
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
            Add Contact
          </button>
        </form>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="crm-empty">
          {contacts.length === 0
            ? "No contacts yet. Add your first contact or ask AI to create one."
            : "No contacts match your filters."}
        </div>
      ) : viewMode === "list" ? (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Title</th>
                <th>Status</th>
                <th>Last Touch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="crm-table-row crm-clickable"
                  onClick={() => router.push(`/crm/contacts/${c.id}`)}
                >
                  <td className="crm-cell-name">{c.first_name} {c.last_name}</td>
                  <td>{c.email}</td>
                  <td>{c.company_name || "—"}</td>
                  <td>{c.title || "—"}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="crm-cell-date">{c.last_touch ? new Date(c.last_touch).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                  <td>
                    <button
                      className="crm-action-btn crm-action-delete"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="crm-card-grid">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="crm-card crm-clickable"
              onClick={() => router.push(`/crm/contacts/${c.id}`)}
            >
              <div className="crm-card-header">
                <h3 className="crm-card-title">{c.first_name} {c.last_name}</h3>
                <button
                  className="crm-action-btn crm-action-delete"
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                >
                  ×
                </button>
              </div>
              {c.title && <div className="crm-card-meta">{c.title}</div>}
              <div className="crm-card-stats">
                <StatusBadge status={c.status} />
                {c.company_name && <span className="crm-card-stat">{c.company_name}</span>}
              </div>
              <div className="crm-contact-card-details">
                {c.email && <div className="crm-contact-card-field">{c.email}</div>}
                {c.phone && <div className="crm-contact-card-field">{c.phone}</div>}
              </div>
              {c.tags.length > 0 && (
                <div className="crm-card-tags">
                  {c.tags.map(t => <span key={t} className="crm-tag">{t}</span>)}
                </div>
              )}
              {c.last_touch && (
                <div className="crm-card-footer-date">
                  Last touch: {new Date(c.last_touch).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
