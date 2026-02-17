"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import { ActivityIcon, ActivityLabel } from "./shared";
import type { CrmActivity, ActivityType } from "@/lib/types/database";

const TYPE_OPTIONS: ActivityType[] = ["call", "email", "meeting", "note", "task"];

interface ActivityRow extends CrmActivity {
  contact_name?: string;
  company_name?: string;
}

export default function ActivitiesTab() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const supabase = createClient();

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    type: "note" as ActivityType,
    subject: "",
    description: "",
    contact_id: "",
    scheduled_at: "",
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [actRes, contactsRes, companiesRes] = await Promise.all([
      supabase.from("crm_activities").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, first_name, last_name"),
      supabase.from("crm_companies").select("id, name"),
    ]);

    const contactMap: Record<string, string> = {};
    const companyMap: Record<string, string> = {};
    if (contactsRes.data) {
      for (const c of contactsRes.data) contactMap[c.id] = `${c.first_name} ${c.last_name}`.trim();
      setContacts(contactsRes.data.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() })));
    }
    if (companiesRes.data) for (const c of companiesRes.data) companyMap[c.id] = c.name;

    if (actRes.data) {
      setActivities(
        (actRes.data as CrmActivity[]).map((a) => ({
          ...a,
          contact_name: a.contact_id ? contactMap[a.contact_id] ?? "" : "",
          company_name: a.company_id ? companyMap[a.company_id] ?? "" : "",
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
    if (!user || !form.subject.trim()) return;

    const { error } = await supabase.from("crm_activities").insert({
      user_id: user.id,
      org_id: orgId,
      type: form.type,
      subject: form.subject.trim(),
      description: form.description.trim(),
      contact_id: form.contact_id || null,
      scheduled_at: form.scheduled_at || null,
    });

    if (!error) {
      setForm({ type: "note", subject: "", description: "", contact_id: "", scheduled_at: "" });
      setShowForm(false);
      loadData();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("crm_activities").delete().eq("id", id);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const handleToggleComplete = async (activity: ActivityRow) => {
    const newCompleted = activity.completed_at ? null : new Date().toISOString();
    await supabase.from("crm_activities").update({ completed_at: newCompleted }).eq("id", activity.id);
    loadData();
    window.dispatchEvent(new Event("workspace-updated"));
  };

  const filtered = activities.filter((a) => {
    if (filterType && a.type !== filterType) return false;
    return true;
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  if (loading) return <div className="crm-loading">Loading activities...</div>;

  return (
    <div className="crm-tab-content">
      <div className="crm-toolbar">
        <select
          className="crm-filter-select"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Activity"}
        </button>
      </div>

      {showForm && (
        <form className="crm-inline-form" onSubmit={handleSubmit}>
          <div className="crm-form-grid">
            <select className="crm-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ActivityType })}>
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <input className="crm-input" placeholder="Subject *" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <select className="crm-input" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
              <option value="">No contact</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="crm-input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          <textarea className="crm-input crm-textarea" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Log Activity</button>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="crm-empty">
          {activities.length === 0
            ? "No activities yet. Log your first activity or ask AI to log one."
            : "No activities match your filter."}
        </div>
      ) : (
        <div className="crm-activity-list">
          {filtered.map((a) => (
            <div key={a.id} className={`crm-activity-item ${a.completed_at ? "crm-activity-completed" : ""}`}>
              <div className="crm-activity-left">
                <ActivityIcon type={a.type} />
              </div>
              <div className="crm-activity-body">
                <div className="crm-activity-header">
                  <span className="crm-activity-type"><ActivityLabel type={a.type} /></span>
                  <span className="crm-activity-subject">{a.subject}</span>
                  {a.completed_at && <span className="crm-activity-done">✓</span>}
                </div>
                {a.description && <div className="crm-activity-desc">{a.description}</div>}
                <div className="crm-activity-meta">
                  {a.contact_name && <span>with {a.contact_name}</span>}
                  {a.company_name && <span> at {a.company_name}</span>}
                  <span className="crm-activity-date">{formatDate(a.created_at)}</span>
                </div>
              </div>
              <div className="crm-activity-actions">
                <button
                  className={`crm-action-btn ${a.completed_at ? "crm-action-uncomplete" : "crm-action-complete"}`}
                  title={a.completed_at ? "Mark incomplete" : "Mark complete"}
                  onClick={() => handleToggleComplete(a)}
                >
                  {a.completed_at ? "↩" : "✓"}
                </button>
                <button
                  className="crm-action-btn crm-action-delete"
                  title="Delete"
                  onClick={() => handleDelete(a.id)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
