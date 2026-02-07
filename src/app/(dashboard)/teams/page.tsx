"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";

/* ── Types ────────────────────────────────────────────── */

interface TeamWithCounts {
  id: string;
  slug: string;
  name: string;
  description: string;
  created_at: string;
  roleCount: number;
  headcount: number;
  kpiCount: number;
  toolCount: number;
}

/* ── Slug helper ──────────────────────────────────────── */

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ── Component ────────────────────────────────────────── */

export default function TeamsPage() {
  const { user } = useAuth();
  const supabase = createClient();

  const [teams, setTeams] = useState<TeamWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [formError, setFormError] = useState("");

  /* ══════════════════════════════════════════════════════
     LOAD all teams + child counts
     ══════════════════════════════════════════════════════ */

  const loadTeams = useCallback(async () => {
    if (!user) return;

    /* Fetch teams + all child rows in parallel */
    const [teamsRes, rolesRes, kpisRes, toolsRes] = await Promise.all([
      supabase.from("teams").select("*").order("created_at"),
      supabase.from("team_roles").select("id, team_id, headcount"),
      supabase.from("team_kpis").select("id, team_id"),
      supabase.from("team_tools").select("id, team_id"),
    ]);

    const rawTeams = teamsRes.data ?? [];
    const roles = rolesRes.data ?? [];
    const kpis = kpisRes.data ?? [];
    const tools = toolsRes.data ?? [];

    /* Group counts by team_id */
    const roleCounts: Record<string, { count: number; headcount: number }> = {};
    for (const r of roles) {
      if (!roleCounts[r.team_id]) roleCounts[r.team_id] = { count: 0, headcount: 0 };
      roleCounts[r.team_id].count++;
      roleCounts[r.team_id].headcount += r.headcount ?? 1;
    }

    const kpiCounts: Record<string, number> = {};
    for (const k of kpis) {
      kpiCounts[k.team_id] = (kpiCounts[k.team_id] ?? 0) + 1;
    }

    const toolCounts: Record<string, number> = {};
    for (const t of tools) {
      toolCounts[t.team_id] = (toolCounts[t.team_id] ?? 0) + 1;
    }

    setTeams(
      rawTeams.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name || t.slug,
        description: t.description ?? "",
        created_at: t.created_at,
        roleCount: roleCounts[t.id]?.count ?? 0,
        headcount: roleCounts[t.id]?.headcount ?? 0,
        kpiCount: kpiCounts[t.id] ?? 0,
        toolCount: toolCounts[t.id] ?? 0,
      }))
    );

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadTeams();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadTeams]);

  /* ══════════════════════════════════════════════════════
     ADD team
     ══════════════════════════════════════════════════════ */

  const addTeam = async () => {
    if (!form.name.trim() || !user) return;

    const slug = toSlug(form.name);
    if (!slug) {
      setFormError("Name must contain at least one letter or number.");
      return;
    }

    /* Check for duplicate slug */
    const existing = teams.find((t) => t.slug === slug);
    if (existing) {
      setFormError(`A team with the URL "${slug}" already exists.`);
      return;
    }

    const { data: row, error } = await supabase
      .from("teams")
      .insert({
        user_id: user.id,
        slug,
        name: form.name.trim(),
        description: form.description.trim(),
      })
      .select()
      .single();

    if (error || !row) {
      console.error("Add team error:", error?.message);
      setFormError(error?.message ?? "Failed to create team.");
      return;
    }

    setTeams((prev) => [
      ...prev,
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? "",
        created_at: row.created_at,
        roleCount: 0,
        headcount: 0,
        kpiCount: 0,
        toolCount: 0,
      },
    ]);

    setForm({ name: "", description: "" });
    setFormError("");
    setShowForm(false);
  };

  /* ══════════════════════════════════════════════════════
     DELETE team
     ══════════════════════════════════════════════════════ */

  const deleteTeam = async (id: string) => {
    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) {
      console.error("Delete team error:", error.message);
      return;
    }
    setTeams((prev) => prev.filter((t) => t.id !== id));
  };

  /* ── Computed stats ── */
  const totalHeadcount = teams.reduce((s, t) => s + t.headcount, 0);
  const totalKpis = teams.reduce((s, t) => s + t.kpiCount, 0);
  const totalTools = teams.reduce((s, t) => s + t.toolCount, 0);

  /* ── Loading state ── */
  if (loading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Teams</h1>
          <p className="canvas-subtitle">Your organization&apos;s teams and departments</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state"><p>Loading teams…</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ─── Header ─── */}
      <div
        className="canvas-header"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div>
          <h1 className="canvas-title">Teams</h1>
          <p className="canvas-subtitle">
            Your organization&apos;s teams and departments
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm(!showForm);
            setFormError("");
          }}
        >
          {showForm ? "Cancel" : "+ Add Team"}
        </button>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {/* ── Add Team Form ── */}
        {showForm && (
          <div className="inline-form" style={{ marginBottom: 24 }}>
            <input
              className="input"
              placeholder="Team name (e.g. Sales, Product, Engineering)"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setFormError("");
              }}
              autoFocus
            />
            <input
              className="input"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addTeam()}
            />
            {form.name.trim() && (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                URL: /teams/{toSlug(form.name) || "…"}
              </div>
            )}
            {formError && (
              <div style={{ fontSize: 13, color: "var(--color-error)" }}>{formError}</div>
            )}
            <div className="inline-form-actions">
              <button className="btn btn-primary btn-sm" onClick={addTeam}>
                Create Team
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setShowForm(false);
                  setForm({ name: "", description: "" });
                  setFormError("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Org Summary Bar ── */}
        <div style={{
          display: "flex",
          gap: 24,
          padding: "12px 0",
          marginBottom: 24,
          borderBottom: "1px solid var(--color-gray-100)",
          fontSize: 13,
          color: "#6b7280",
        }}>
          <span><strong style={{ color: "var(--color-gray-900)", fontSize: 15 }}>{teams.length}</strong> teams</span>
          <span><strong style={{ color: "var(--color-gray-900)", fontSize: 15 }}>{totalHeadcount}</strong> people</span>
          <span><strong style={{ color: "var(--color-gray-900)", fontSize: 15 }}>{totalKpis}</strong> KPIs</span>
          <span><strong style={{ color: "var(--color-gray-900)", fontSize: 15 }}>{totalTools}</strong> tools</span>
        </div>

        {/* ── Team List ── */}
        {teams.length === 0 && !showForm ? (
          <div className="empty-state">
            <p>No teams yet. Click &quot;+ Add Team&quot; to create your first team.</p>
          </div>
        ) : (
          <div className="item-list">
            {teams.map((team) => (
              <Link
                key={team.id}
                href={`/teams/${team.slug}`}
                prefetch={false}
                className="item-row"
                style={{ textDecoration: "none", color: "inherit", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                {/* Team initial avatar */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--color-primary-50)",
                  color: "var(--color-primary-500)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: 14,
                  flexShrink: 0,
                  marginRight: 14,
                }}>
                  {team.name.charAt(0).toUpperCase()}
                </div>

                {/* Name + description */}
                <div className="item-content" style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-name" style={{ marginBottom: 2 }}>{team.name}</div>
                  {team.description && (
                    <div className="item-desc" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {team.description}
                    </div>
                  )}
                </div>

                {/* Inline metrics */}
                <div style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 12,
                  color: "#9ca3af",
                  flexShrink: 0,
                  marginLeft: 16,
                }}>
                  <span style={{ minWidth: 52, textAlign: "right" }}>
                    <strong style={{ color: "#374151" }}>{team.headcount}</strong> people
                  </span>
                  <span style={{ minWidth: 42, textAlign: "right" }}>
                    <strong style={{ color: "#374151" }}>{team.roleCount}</strong> roles
                  </span>
                  <span style={{ minWidth: 38, textAlign: "right" }}>
                    <strong style={{ color: "#374151" }}>{team.kpiCount}</strong> KPIs
                  </span>
                  <span style={{ minWidth: 40, textAlign: "right" }}>
                    <strong style={{ color: "#374151" }}>{team.toolCount}</strong> tools
                  </span>
                </div>

                {/* Delete */}
                <button
                  className="item-delete"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteTeam(team.id);
                  }}
                  title="Delete team"
                  style={{ marginLeft: 12 }}
                >
                  &times;
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
