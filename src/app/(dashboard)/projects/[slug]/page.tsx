"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import CanvasEditor from "@/components/canvas/CanvasEditor";
import FullChat from "@/components/layout/FullChat";
import WorkflowEditor from "@/components/workflow/WorkflowEditor";
import { snapshotWorkflow } from "@/components/workflow/WorkflowHistory";
import type { Project, ProjectMode, CanvasBlock, WorkflowData } from "@/lib/types/database";

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

  /* ── Save workflow data (debounced 1s) ── */
  const handleWorkflowChange = useCallback(
    (wfData: WorkflowData) => {
      if (!project) return;
      const serialized = [wfData] as unknown as Record<string, unknown>[];
      setProject((prev) => (prev ? { ...prev, workflow_nodes: serialized } : prev));
      setSaved(false);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const supabase = createClient();
        await supabase
          .from("projects")
          .update({ workflow_nodes: serialized })
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

      /* Snapshot current workflow before AI overwrites it */
      if (project?.id && project.workflow_nodes?.[0]) {
        const currentWf = project.workflow_nodes[0] as unknown as WorkflowData;
        if (currentWf.nodes?.length > 0) {
          snapshotWorkflow(project.id, currentWf, "Before AI update");
        }
      }

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
  }, [slug, user, project]);

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
          <WorkflowEditor
            projectId={project.id}
            data={
              project.workflow_nodes?.[0]
                ? (project.workflow_nodes[0] as unknown as WorkflowData)
                : { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
            }
            onChange={handleWorkflowChange}
          />
        </div>
      )}
    </div>
  );
}
