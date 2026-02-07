"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import CanvasEditor from "@/components/canvas/CanvasEditor";
import FullChat from "@/components/layout/FullChat";
import type { Project, ProjectMode, CanvasBlock } from "@/lib/types/database";

/* ── Mode config ─────────────────────────────────────── */
const modes: { key: ProjectMode; label: string }[] = [
  { key: "canvas",   label: "Canvas" },
  { key: "workflow",  label: "Builder" },
  { key: "chat",     label: "AI Chat" },
];

export default function ProjectWorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeMode, setActiveMode] = useState<ProjectMode>("canvas");
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Load project ── */
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("*")
      .eq("slug", slug)
      .eq("user_id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          router.replace("/brainstorm");
          return;
        }
        setProject(data as Project);
        setActiveMode(data.active_mode as ProjectMode);
        setLoading(false);
      });
  }, [slug, user, router]);

  /* ── Switch mode ── */
  const switchMode = useCallback(
    async (mode: ProjectMode) => {
      if (!project) return;
      setActiveMode(mode);
      const supabase = createClient();
      await supabase
        .from("projects")
        .update({ active_mode: mode })
        .eq("id", project.id);
    },
    [project]
  );

  /* ── Save canvas blocks (debounced 1s) ── */
  const handleCanvasChange = useCallback(
    (blocks: CanvasBlock[]) => {
      if (!project) return;
      setProject((prev) => (prev ? { ...prev, canvas_blocks: blocks } : prev));
      setSaved(false);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const supabase = createClient();
        await supabase
          .from("projects")
          .update({ canvas_blocks: blocks as unknown as Record<string, unknown>[] })
          .eq("id", project.id);
        setSaved(true);
      }, 1000);
    },
    [project]
  );

  /* ── Cleanup timer ── */
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /* ── Listen for AI updates ── */
  useEffect(() => {
    const handler = () => {
      if (!user) return;
      const supabase = createClient();
      supabase
        .from("projects")
        .select("*")
        .eq("slug", slug)
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setProject(data as Project);
          }
        });
    };
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [slug, user]);

  if (loading) {
    return (
      <div className="canvas-content">
        <div className="empty-state"><p>Loading project…</p></div>
      </div>
    );
  }

  if (!project) return null;

  /* ── Chat mode: render FullChat as the entire content ── */
  if (activeMode === "chat") {
    return (
      <div className="project-workspace">
        {/* Header */}
        <div className="project-workspace-header">
          <div className="project-workspace-left">
            <button className="project-back-btn" onClick={() => router.push("/brainstorm")}>
              ← Projects
            </button>
            <h1 className="project-workspace-title">{project.name}</h1>
          </div>
          <div className="project-mode-switcher">
            {modes.map((m) => (
              <button
                key={m.key}
                className={`project-mode-pill ${activeMode === m.key ? "active" : ""}`}
                onClick={() => switchMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="project-workspace-right">
            <span className="project-save-status">{saved ? "Auto-saved" : "Saving…"}</span>
          </div>
        </div>

        {/* Full chat takes over */}
        <FullChat />
      </div>
    );
  }

  return (
    <div className="project-workspace">
      {/* Header */}
      <div className="project-workspace-header">
        <div className="project-workspace-left">
          <button className="project-back-btn" onClick={() => router.push("/brainstorm")}>
            ← Projects
          </button>
          <h1 className="project-workspace-title">{project.name}</h1>
        </div>
        <div className="project-mode-switcher">
          {modes.map((m) => (
            <button
              key={m.key}
              className={`project-mode-pill ${activeMode === m.key ? "active" : ""}`}
              onClick={() => switchMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="project-workspace-right">
          <span className="project-save-status">{saved ? "Auto-saved" : "Saving…"}</span>
        </div>
      </div>

      {/* Canvas mode */}
      {activeMode === "canvas" && (
        <div className="project-canvas-area">
          <CanvasEditor
            blocks={project.canvas_blocks ?? []}
            onChange={handleCanvasChange}
          />
        </div>
      )}

      {/* Workflow mode */}
      {activeMode === "workflow" && (
        <div className="whiteboard">
          {/* Empty state */}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "#9ca3af", marginBottom: 8 }}>
                Drag and drop nodes to build your process flow
              </p>
              <p style={{ fontSize: 12, color: "#d1d5db" }}>
                Use the toolbar below to add steps, decisions, and AI agents
              </p>
            </div>
          </div>

          {/* Floating Toolbar */}
          <div className="floating-toolbar">
            <button className="toolbar-btn">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 1l3 3-8.5 8.5H1.5V9.5L10 1z" /></svg>
              Edit
            </button>
            <div className="toolbar-divider" />
            <button className="toolbar-btn">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="2" /><path d="M7 4v6M4 7h6" /></svg>
              Add Node
            </button>
            <button className="toolbar-btn">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="1" fill="#fef3c7" stroke="#d1d5db" /><path d="M4 5h6M4 8h4" /></svg>
              Add Note
            </button>
            <div className="toolbar-divider" />
            <button className="toolbar-btn toolbar-btn-accent">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="3,1 13,7 3,13" /></svg>
              Simulate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
