"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge, ActivityIcon, ActivityLabel, DealValue, formatCurrency } from "@/components/crm/shared";
import CustomFieldsSection from "@/components/crm/CustomFieldsSection";
import type { CrmContact, CrmCompany, CrmDeal, CrmActivity, ContactStatus } from "@/lib/types/database";

const STATUS_OPTIONS: ContactStatus[] = ["lead", "active", "inactive", "churned"];
type DetailTab = "details" | "opportunities" | "activities";
type OpptyFilter = "all" | "active" | "won" | "lost";

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();

  const [contact, setContact] = useState<CrmContact | null>(null);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CrmContact>>({});
  const [tagInput, setTagInput] = useState("");
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const [opptyFilter, setOpptyFilter] = useState<OpptyFilter>("all");

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);

    const { data: contactData } = await supabase.from("crm_contacts").select("*").eq("id", id).single();
    if (!contactData) { setLoading(false); return; }
    setContact(contactData as CrmContact);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promises: any[] = [
      supabase.from("crm_deals").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_activities").select("*").eq("contact_id", id).order("created_at", { ascending: false }),
    ];
    if (contactData.company_id) {
      promises.push(supabase.from("crm_companies").select("*").eq("id", contactData.company_id).single());
    }

    const results = await Promise.all(promises);
    if ((results[0] as { data: CrmDeal[] | null }).data) setDeals((results[0] as { data: CrmDeal[] }).data);
    if ((results[1] as { data: CrmActivity[] | null }).data) setActivities((results[1] as { data: CrmActivity[] }).data);
    if (contactData.company_id && results[2]) {
      const cr = results[2] as { data: CrmCompany | null };
      if (cr.data) setCompany(cr.data);
    }
    setLoading(false);
  }, [user?.id, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  const handleEdit = () => {
    if (!contact) return;
    setEditForm({
      first_name: contact.first_name, last_name: contact.last_name,
      email: contact.email, phone: contact.phone, title: contact.title,
      status: contact.status, notes: contact.notes, tags: [...contact.tags],
    });
    setTagInput("");
    setEditing(true);
  };

  const handleSave = async () => {
    if (!contact) return;
    const { error } = await supabase.from("crm_contacts")
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq("id", contact.id);
    if (!error) { setEditing(false); loadData(); window.dispatchEvent(new Event("workspace-updated")); }
  };

  const handleDelete = async () => {
    if (!contact) return;
    await supabase.from("crm_contacts").delete().eq("id", contact.id);
    window.dispatchEvent(new Event("workspace-updated"));
    router.push("/crm?tab=contacts");
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  /* Opportunity filtering */
  const activeDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const wonDeals = deals.filter((d) => d.stage === "won");
  const lostDeals = deals.filter((d) => d.stage === "lost");
  const filteredDeals =
    opptyFilter === "active" ? activeDeals
    : opptyFilter === "won" ? wonDeals
    : opptyFilter === "lost" ? lostDeals
    : deals;

  if (loading) return <div className="crm-loading">Loading contact...</div>;
  if (!contact) return <div className="crm-empty">Contact not found.</div>;

  return (
    <div className="crm-detail-page">
      <button className="crm-back-btn" onClick={() => router.push("/crm?tab=contacts")}>← Back</button>

      {/* Header */}
      <div className="crm-detail-header">
        <div className="crm-detail-header-main">
          <div>
            <h1 className="crm-detail-name">{contact.first_name} {contact.last_name}</h1>
            <div className="crm-detail-subtitle">
              {contact.title && <span>{contact.title}</span>}
              {contact.title && company && <span> · </span>}
              {company && (
                <span
                  className="crm-clickable"
                  style={{ color: "var(--color-primary)", cursor: "pointer" }}
                  onClick={() => router.push(`/crm/companies/${company.id}`)}
                >
                  {company.name}
                </span>
              )}
            </div>
          </div>
          <div className="crm-detail-actions">
            <StatusBadge status={contact.status} />
            <button className="btn btn-secondary btn-sm" onClick={handleEdit}>Edit</button>
            <button className="btn btn-secondary btn-sm crm-btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="crm-detail-section crm-detail-edit" style={{ marginBottom: 20 }}>
          <div className="crm-form-grid">
            <input className="crm-input" placeholder="First name" value={editForm.first_name ?? ""} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
            <input className="crm-input" placeholder="Last name" value={editForm.last_name ?? ""} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            <input className="crm-input" placeholder="Email" value={editForm.email ?? ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <input className="crm-input" placeholder="Phone" value={editForm.phone ?? ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <input className="crm-input" placeholder="Title" value={editForm.title ?? ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            <select className="crm-input" value={editForm.status ?? "lead"} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as ContactStatus })}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <textarea className="crm-input crm-textarea" placeholder="Notes" value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
          <div className="crm-tags-edit">
            <label className="crm-field-label" style={{ marginBottom: 4, display: "block" }}>Tags</label>
            <div className="crm-tags-list">
              {(editForm.tags ?? []).map((tag, i) => (
                <span key={i} className="crm-tag crm-tag-removable">
                  {tag}
                  <button type="button" className="crm-tag-remove" onClick={() => {
                    const newTags = [...(editForm.tags ?? [])];
                    newTags.splice(i, 1);
                    setEditForm({ ...editForm, tags: newTags });
                  }}>×</button>
                </span>
              ))}
            </div>
            <div className="crm-tags-input-wrap">
              <input className="crm-input crm-tags-input" placeholder="Add tag and press Enter" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    e.preventDefault();
                    const tag = tagInput.trim().toLowerCase();
                    if (!(editForm.tags ?? []).includes(tag)) {
                      setEditForm({ ...editForm, tags: [...(editForm.tags ?? []), tag] });
                    }
                    setTagInput("");
                  }
                }}
              />
            </div>
          </div>
          <div className="crm-detail-edit-actions">
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="crm-detail-tabs">
        {(["details", "opportunities", "activities"] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            className={`crm-detail-tab ${activeTab === tab ? "crm-detail-tab-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "details" ? "Details" : tab === "opportunities" ? `Opportunities (${deals.length})` : `Activities (${activities.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "details" && (
        <div className="crm-detail-grid">
          {/* Contact Info */}
          <div className="crm-detail-section">
            <h3 className="crm-detail-section-title">Contact Info</h3>
            <div className="crm-detail-fields">
              {contact.email && <div className="crm-detail-field"><span className="crm-field-label">Email</span><span>{contact.email}</span></div>}
              {contact.phone && <div className="crm-detail-field"><span className="crm-field-label">Phone</span><span>{contact.phone}</span></div>}
              <div className="crm-detail-field"><span className="crm-field-label">Source</span><span>{contact.source}</span></div>
              {contact.tags.length > 0 && (
                <div className="crm-detail-field">
                  <span className="crm-field-label">Tags</span>
                  <span className="crm-tags">{contact.tags.map(t => <span key={t} className="crm-tag">{t}</span>)}</span>
                </div>
              )}
              <div className="crm-detail-field"><span className="crm-field-label">Created</span><span>{fmt(contact.created_at)}</span></div>
            </div>
          </div>

          {/* Company */}
          {company && (
            <div className="crm-detail-section">
              <h3 className="crm-detail-section-title">Company</h3>
              <div className="crm-company-card crm-clickable" onClick={() => router.push(`/crm/companies/${company.id}`)}>
                <div className="crm-card-title">{company.name}</div>
                {company.industry && <div className="crm-card-meta">{company.industry}</div>}
                {company.employees && <div className="crm-detail-meta">{company.employees.toLocaleString()} employees</div>}
              </div>
            </div>
          )}

          {/* Notes */}
          {contact.notes && (
            <div className="crm-detail-section" style={{ gridColumn: "1 / -1" }}>
              <h3 className="crm-detail-section-title">Notes</h3>
              <div className="crm-detail-notes">{contact.notes}</div>
            </div>
          )}

          {/* Custom Fields */}
          <div style={{ gridColumn: "1 / -1" }}>
            <CustomFieldsSection
              tableName="crm_contacts"
              metadata={(contact.metadata as Record<string, unknown>) || {}}
              entityId={contact.id}
              onUpdate={loadData}
            />
          </div>
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
            <div className="crm-detail-empty">No activities logged yet.</div>
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
    </div>
  );
}
