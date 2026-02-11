"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";

/* ── Form shape ───────────────────────────────────────── */

interface ProfileForm {
  display_name: string;
  job_title: string;
  department: string;
  bio: string;
  areas_of_expertise: string; // comma-separated in form, array in DB
  years_of_experience: string;
  decision_authority: string;
  communication_preferences: string;
  key_responsibilities: string;
  focus_areas: string;
}

const blankProfile: ProfileForm = {
  display_name: "",
  job_title: "",
  department: "",
  bio: "",
  areas_of_expertise: "",
  years_of_experience: "",
  decision_authority: "",
  communication_preferences: "",
  key_responsibilities: "",
  focus_areas: "",
};

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function ProfilePage() {
  const { user } = useAuth();
  const supabase = createClient();

  /* ── State ── */
  const [form, setForm] = useState<ProfileForm>(blankProfile);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  /* ── Load profile ── */
  const loadProfile = useCallback(async () => {
    if (!user) return;

    const { data } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setProfileId(data.id);
      setForm({
        display_name: data.display_name ?? "",
        job_title: data.job_title ?? "",
        department: data.department ?? "",
        bio: data.bio ?? "",
        areas_of_expertise: (data.areas_of_expertise ?? []).join(", "),
        years_of_experience: data.years_of_experience ?? "",
        decision_authority: data.decision_authority ?? "",
        communication_preferences: data.communication_preferences ?? "",
        key_responsibilities: data.key_responsibilities ?? "",
        focus_areas: data.focus_areas ?? "",
      });
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadProfile();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadProfile]);

  /* ── Auto-save on blur ── */
  const saveField = async (field: keyof ProfileForm, value: string) => {
    if (!user) return;
    setSaving(true);

    /* Convert areas_of_expertise from comma string to array for DB */
    let dbValue: string | string[] = value;
    if (field === "areas_of_expertise") {
      dbValue = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const updates = {
      [field]: dbValue,
      updated_at: new Date().toISOString(),
    };

    if (profileId) {
      /* Update existing */
      await supabase.from("user_profiles").update(updates).eq("id", profileId);
    } else {
      /* Create new (upsert) */
      const formForDb: Record<string, unknown> = { ...form };
      formForDb.areas_of_expertise = form.areas_of_expertise
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const { data } = await supabase
        .from("user_profiles")
        .upsert(
          { user_id: user.id, ...formForDb, ...updates },
          { onConflict: "user_id" }
        )
        .select()
        .single();
      if (data) setProfileId(data.id);
    }

    setSaving(false);
    setLastSaved(new Date().toLocaleTimeString());
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Handlers ── */
  const handleChange = (field: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field: keyof ProfileForm) => {
    saveField(field, form[field]);
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">My Profile</h1>
          <p className="canvas-subtitle">Tell the AI about your role, expertise, and preferences</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state">
            <p>Loading profile…</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ─── Header ─── */}
      <div
        className="canvas-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 className="canvas-title">My Profile</h1>
          <p className="canvas-subtitle">
            Tell the AI about your role, expertise, and preferences
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#6b7280" }}>
          {saving && <span>Saving…</span>}
          {!saving && lastSaved && <span>Saved {lastSaved}</span>}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {/* ── Two-column short fields ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Display Name */}
          <div>
            <label className="field-label">Display Name</label>
            <input
              className="input"
              placeholder="e.g. Sarah Chen"
              value={form.display_name}
              onChange={(e) => handleChange("display_name", e.target.value)}
              onBlur={() => handleBlur("display_name")}
            />
          </div>

          {/* Job Title */}
          <div>
            <label className="field-label">Job Title / Role</label>
            <input
              className="input"
              placeholder="e.g. VP of Operations, Head of Growth"
              value={form.job_title}
              onChange={(e) => handleChange("job_title", e.target.value)}
              onBlur={() => handleBlur("job_title")}
            />
          </div>

          {/* Department */}
          <div>
            <label className="field-label">Department</label>
            <input
              className="input"
              placeholder="e.g. Operations, Engineering, Marketing"
              value={form.department}
              onChange={(e) => handleChange("department", e.target.value)}
              onBlur={() => handleBlur("department")}
            />
          </div>

          {/* Years of Experience */}
          <div>
            <label className="field-label">Years of Experience</label>
            <input
              className="input"
              placeholder="e.g. 10+, 3-5 years"
              value={form.years_of_experience}
              onChange={(e) => handleChange("years_of_experience", e.target.value)}
              onBlur={() => handleBlur("years_of_experience")}
            />
          </div>
        </div>

        {/* ── Full-width text fields ── */}

        {/* Bio */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Bio / About</label>
          <textarea
            className="input textarea"
            rows={3}
            placeholder="Brief background — what's your story? What brought you to this role?"
            value={form.bio}
            onChange={(e) => handleChange("bio", e.target.value)}
            onBlur={() => handleBlur("bio")}
          />
        </div>

        {/* Key Responsibilities */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Key Responsibilities</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="What are you primarily responsible for? e.g. Revenue growth, team scaling, product roadmap"
            value={form.key_responsibilities}
            onChange={(e) => handleChange("key_responsibilities", e.target.value)}
            onBlur={() => handleBlur("key_responsibilities")}
          />
        </div>

        {/* Areas of Expertise */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Areas of Expertise</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="Comma-separated: e.g. SaaS growth, team scaling, product ops, data analytics"
            value={form.areas_of_expertise}
            onChange={(e) => handleChange("areas_of_expertise", e.target.value)}
            onBlur={() => handleBlur("areas_of_expertise")}
          />
        </div>

        {/* Focus Areas */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Focus Areas / Current Priorities</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="What are you focused on right now? e.g. Q1 pipeline, reducing churn, launching new product"
            value={form.focus_areas}
            onChange={(e) => handleChange("focus_areas", e.target.value)}
            onBlur={() => handleBlur("focus_areas")}
          />
        </div>

        {/* Decision Authority */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Decision-Making Authority</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="What can you approve? e.g. Budget up to $50K, hiring for your team, vendor selection"
            value={form.decision_authority}
            onChange={(e) => handleChange("decision_authority", e.target.value)}
            onBlur={() => handleBlur("decision_authority")}
          />
        </div>

        {/* Communication Preferences */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Communication Preferences</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="How should the AI talk to you? e.g. Concise bullet points, strategic framing, skip the basics, give me numbers"
            value={form.communication_preferences}
            onChange={(e) => handleChange("communication_preferences", e.target.value)}
            onBlur={() => handleBlur("communication_preferences")}
          />
        </div>
      </div>
    </>
  );
}
