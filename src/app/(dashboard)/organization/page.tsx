"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { OrgStage } from "@/lib/types/database";
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE,
  isTextReadable,
  readFileText,
  formatFileSize,
  getFileExt,
  fmtFileDate,
} from "@/lib/utils/file-helpers";

/* ── Stage options ─────────────────────────────────────── */

const stages: OrgStage[] = [
  "Idea",
  "Pre-Seed",
  "Seed",
  "Series A",
  "Series B",
  "Series C+",
  "Growth",
  "Public",
];

/* ── File type ─────────────────────────────────────────── */

interface OrgFileItem {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

/* ── Blank form state ──────────────────────────────────── */

interface OrgForm {
  name: string;
  industry: string;
  description: string;
  website: string;
  stage: OrgStage | "";
  target_market: string;
  differentiators: string;
  notes: string;
}

const blankOrg: OrgForm = {
  name: "",
  industry: "",
  description: "",
  website: "",
  stage: "",
  target_market: "",
  differentiators: "",
  notes: "",
};

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function OrganizationPage() {
  const { user } = useAuth();
  const supabase = createClient();

  /* ── Form state ── */
  const [form, setForm] = useState<OrgForm>(blankOrg);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  /* ── Team size (calculated) ── */
  const [teamSize, setTeamSize] = useState<number>(0);

  /* ── File state ── */
  const [orgFiles, setOrgFiles] = useState<OrgFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Load organization data ── */
  const loadOrg = useCallback(async () => {
    if (!user) return;

    const [orgRes, filesRes, rolesRes] = await Promise.all([
      supabase.from("organizations").select("*").eq("user_id", user.id).single(),
      supabase
        .from("organization_files")
        .select("id, name, size, mime_type, storage_path, text_content, added_at")
        .order("added_at", { ascending: false }),
      supabase.from("team_roles").select("headcount"),
    ]);

    if (orgRes.data) {
      const d = orgRes.data;
      setOrgId(d.id);
      setForm({
        name: d.name ?? "",
        industry: d.industry ?? "",
        description: d.description ?? "",
        website: d.website ?? "",
        stage: d.stage ?? "",
        target_market: d.target_market ?? "",
        differentiators: d.differentiators ?? "",
        notes: d.notes ?? "",
      });
    }

    if (filesRes.data) {
      setOrgFiles(filesRes.data);
    }

    /* Calculate total team size */
    if (rolesRes.data) {
      const total = rolesRes.data.reduce(
        (sum, r) => sum + ((r.headcount as number) ?? 0),
        0
      );
      setTeamSize(total);
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadOrg();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadOrg]);

  /* ── Auto-save on blur ── */
  const saveField = async (field: keyof OrgForm, value: string) => {
    if (!user) return;
    setSaving(true);

    const updates = { [field]: value, updated_at: new Date().toISOString() };

    if (orgId) {
      /* Update existing */
      await supabase.from("organizations").update(updates).eq("id", orgId);
    } else {
      /* Create new (upsert) */
      const { data } = await supabase
        .from("organizations")
        .upsert(
          { user_id: user.id, ...blankOrg, ...form, ...updates },
          { onConflict: "user_id" }
        )
        .select()
        .single();
      if (data) setOrgId(data.id);
    }

    setSaving(false);
    setLastSaved(new Date().toLocaleTimeString());
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Change handler with blur save ── */
  const handleChange = (field: keyof OrgForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field: keyof OrgForm) => {
    saveField(field, form[field]);
  };

  /* ══════════════════════════════════════════════════════════
     FILE UPLOAD
     ══════════════════════════════════════════════════════════ */

  const uploadFiles = async (files: File[]) => {
    if (!user) return;
    setUploadError("");

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`${file.name} exceeds 10 MB limit.`);
        continue;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setUploadError(
          `${file.name} has unsupported type. Use: ${ACCEPTED_EXTENSIONS.join(", ")}`
        );
        continue;
      }

      /* Extract text for AI context */
      let textContent: string | null = null;
      if (isTextReadable(file)) {
        try {
          textContent = await readFileText(file);
        } catch {
          textContent = null;
        }
      }

      /* Upload to Supabase Storage */
      const storagePath = `org-files/${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("team-files")
        .upload(storagePath, file);

      if (uploadErr) {
        console.error("Upload error:", uploadErr.message);
        setUploadError(`Upload failed: ${uploadErr.message}`);
        continue;
      }

      /* Insert metadata row */
      const { data: row, error: insertErr } = await supabase
        .from("organization_files")
        .insert({
          user_id: user.id,
          name: file.name,
          size: file.size,
          mime_type: file.type || "application/octet-stream",
          storage_path: storagePath,
          text_content: textContent,
        })
        .select()
        .single();

      if (insertErr || !row) {
        console.error("Insert error:", insertErr?.message);
        continue;
      }

      setOrgFiles((prev) => [
        {
          id: row.id,
          name: row.name,
          size: row.size,
          mime_type: row.mime_type,
          storage_path: row.storage_path,
          text_content: row.text_content,
          added_at: row.added_at,
        },
        ...prev,
      ]);
    }

    window.dispatchEvent(new Event("workspace-updated"));
  };

  const deleteFile = async (id: string) => {
    const file = orgFiles.find((f) => f.id === id);
    if (!file) return;

    await supabase.storage.from("team-files").remove([file.storage_path]);
    await supabase.from("organization_files").delete().eq("id", id);
    setOrgFiles((prev) => prev.filter((f) => f.id !== id));
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Drag-and-drop handlers ── */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0)
      uploadFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Organization</h1>
          <p className="canvas-subtitle">Company profile, files, and business context</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state">
            <p>Loading organization data…</p>
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
          <h1 className="canvas-title">Organization</h1>
          <p className="canvas-subtitle">
            Company profile, files, and business context for AI recommendations
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#6b7280" }}>
          {saving && <span>Saving…</span>}
          {!saving && lastSaved && <span>Saved {lastSaved}</span>}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {/* ── Company Profile Form ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Company Name */}
          <div>
            <label className="field-label">Company Name</label>
            <input
              className="input"
              placeholder="e.g. Acme Corp"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              onBlur={() => handleBlur("name")}
            />
          </div>

          {/* Industry */}
          <div>
            <label className="field-label">Industry</label>
            <input
              className="input"
              placeholder="e.g. B2B SaaS, FinTech, Healthcare"
              value={form.industry}
              onChange={(e) => handleChange("industry", e.target.value)}
              onBlur={() => handleBlur("industry")}
            />
          </div>

          {/* Website */}
          <div>
            <label className="field-label">Website</label>
            <input
              className="input"
              placeholder="e.g. https://acme.com"
              value={form.website}
              onChange={(e) => handleChange("website", e.target.value)}
              onBlur={() => handleBlur("website")}
            />
          </div>

          {/* Stage */}
          <div>
            <label className="field-label">Stage</label>
            <select
              className="select"
              value={form.stage}
              onChange={(e) => {
                handleChange("stage", e.target.value);
                saveField("stage", e.target.value);
              }}
            >
              <option value="">Select stage…</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* What you sell / description */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">What You Sell / Company Description</label>
          <textarea
            className="input textarea"
            rows={3}
            placeholder="Describe your product or service — what problem does it solve?"
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
            onBlur={() => handleBlur("description")}
          />
        </div>

        {/* Target market */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Target Market / ICP</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="Who is your ideal customer? (e.g. Mid-market SaaS companies with 50-500 employees)"
            value={form.target_market}
            onChange={(e) => handleChange("target_market", e.target.value)}
            onBlur={() => handleBlur("target_market")}
          />
        </div>

        {/* Differentiators */}
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Key Differentiators</label>
          <textarea
            className="input textarea"
            rows={2}
            placeholder="What makes you different from competitors?"
            value={form.differentiators}
            onChange={(e) => handleChange("differentiators", e.target.value)}
            onBlur={() => handleBlur("differentiators")}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Notes */}
          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="input textarea"
              rows={3}
              placeholder="Any other business context for AI to know…"
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              onBlur={() => handleBlur("notes")}
            />
          </div>

          {/* Team size (read-only) */}
          <div>
            <label className="field-label">Team Size (auto-calculated from Teams)</label>
            <div
              className="input"
              style={{
                display: "flex",
                alignItems: "center",
                color: teamSize > 0 ? "#111827" : "#9ca3af",
                cursor: "default",
                background: "#f9fafb",
              }}
            >
              {teamSize > 0
                ? `${teamSize} team member${teamSize !== 1 ? "s" : ""}`
                : "Add roles in Teams to auto-calculate"}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
           COMPANY FILES / DOCUMENTS
           ═══════════════════════════════════════════════════════ */}

        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 4px" }}>
            Company Documents
          </h2>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
            Upload pitch decks, one-pagers, or business docs — text files are extracted for AI context
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-zone-compact ${isDragging ? "upload-zone-compact-active" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ marginBottom: orgFiles.length > 0 ? 16 : 0 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={handleFileInput}
            style={{ display: "none" }}
          />
          <span className="upload-zone-compact-text">
            {isDragging ? "Drop files here" : "Drop company docs, pitch decks, or"}
          </span>
          {!isDragging && <span className="upload-browse-btn">browse</span>}
          <span className="upload-zone-compact-hint">
            PDF, CSV, TXT, MD, JSON, TSV
          </span>
        </div>

        {uploadError && (
          <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0" }}>
            {uploadError}
          </p>
        )}

        {/* File list */}
        {orgFiles.length > 0 && (
          <div className="item-list">
            {orgFiles.map((f) => {
              const ext = getFileExt(f.name);
              return (
                <div key={f.id} className="item-row">
                  <div className="item-content">
                    <div
                      className="item-name"
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span className="upload-file-type-badge">{ext}</span>
                      {f.name}
                    </div>
                    <div
                      className="item-meta"
                      style={{ fontSize: 12, color: "#6b7280" }}
                    >
                      <span>{formatFileSize(f.size)}</span>
                      <span style={{ margin: "0 6px" }}>·</span>
                      <span>{fmtFileDate(f.added_at)}</span>
                      {f.text_content !== null && (
                        <>
                          <span style={{ margin: "0 6px" }}>·</span>
                          <span>Text extracted for AI</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    className="item-delete"
                    onClick={() => deleteFile(f.id)}
                    title="Remove file"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
