"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { ProjectMode } from "@/lib/types/database";

/* ── Mode badge config ────────────────────────────────── */

const modeBadge: Record<ProjectMode, { label: string; bg: string; color: string }> = {
  canvas:   { label: "Canvas",   bg: "#eff6ff", color: "#2563eb" },
  workflow: { label: "Workflow", bg: "#f0fdf4", color: "#16a34a" },
  chat:     { label: "AI Chat",  bg: "#faf5ff", color: "#7c3aed" },
};

/* ── Date formatter ───────────────────────────────────── */

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function BrainstormPage() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [projects, setProjects] = useState<
    { id: string; name: string; slug: string; description: string; active_mode: ProjectMode; updated_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  /* ── Load projects ── */
  const loadProjects = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("projects")
      .select("id, name, slug, description, active_mode, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setProjects(data);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const handler = () => loadProjects();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadProjects]);

  /* ── Create project ── */
  const createProject = async () => {
    if (!newName.trim() || !user || creating) return;
    setCreating(true);

    const slug = newName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    const { error } = await supabase.from("projects").insert({
      user_id: user.id,
      name: newName.trim(),
      slug,
      description: newDesc.trim(),
      active_mode: "canvas",
    });

    if (error) {
      console.error("Create project error:", error.message);
      setCreating(false);
      return;
    }

    window.dispatchEvent(new Event("workspace-updated"));
    router.push(`/projects/${slug}`);
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Projects</h1>
          <p className="canvas-subtitle">Canvas, workflows, and AI chat workspaces</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state">
            <p>Loading projects…</p>
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
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div>
          <h1 className="canvas-title">Projects</h1>
          <p className="canvas-subtitle">Canvas, workflows, and AI chat workspaces</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "+ New Project"}
        </button>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        {/* ── Create Form ── */}
        {showForm && (
          <div className="inline-form" style={{ marginBottom: 24 }}>
            <input
              className="input"
              placeholder="Project name (e.g. Q2 Marketing Campaign)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && createProject()}
            />
            <input
              className="input"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
            />
            <div className="inline-form-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={createProject}
                disabled={!newName.trim() || creating}
              >
                {creating ? "Creating…" : "Create Project"}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setShowForm(false);
                  setNewName("");
                  setNewDesc("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Project List ── */}
        {projects.length === 0 && !showForm ? (
          <div className="empty-state">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="1.5"
              style={{ margin: "0 auto 16px" }}
            >
              <rect x="6" y="6" width="36" height="36" rx="4" />
              <path d="M18 24h12M24 18v12" />
            </svg>
            <h3>No projects yet</h3>
            <p>Create your first project to start brainstorming, building workflows, or chatting with AI.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {projects.map((p) => {
              const badge = modeBadge[p.active_mode];
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.slug}`}
                  prefetch={false}
                  className="card-link"
                >
                  <div
                    className="card card-clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 500, color: "#1a1a1a" }}>
                          {p.name}
                        </h3>
                        <span
                          className="tag"
                          style={{ background: badge.bg, color: badge.color, fontSize: 11 }}
                        >
                          {badge.label}
                        </span>
                      </div>
                      {p.description && (
                        <p style={{ fontSize: 13, color: "#6b7280" }}>{p.description}</p>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>
                        {fmtDate(p.updated_at)}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
