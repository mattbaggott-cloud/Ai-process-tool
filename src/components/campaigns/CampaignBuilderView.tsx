"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/context/OrgContext";
import StepList from "./StepList";
import StepEditorSidebar from "./StepEditorSidebar";
import CampaignFlowView from "./CampaignFlowView";
import CampaignReviewView from "./CampaignReviewView";
import SendScheduleEditor from "./SendScheduleEditor";
import TaskBoard from "./TaskBoard";
import TaskDetailDrawer from "./TaskDetailDrawer";
import type {
  EmailCampaign,
  BuilderStep,
  StrategySequenceStep,
  SendSchedule,
  CampaignTask,
} from "@/lib/types/database";

import { STATUS_BADGE_CLASS, capitalise, uid } from "./campaign-constants";

/* ── Helpers ──────────────────────────────────────────────── */
function toBuilderSteps(steps: StrategySequenceStep[]): BuilderStep[] {
  return steps.map((s) => ({ ...s, id: uid() }));
}

type BuilderTab = "steps" | "flow" | "review" | "tasks" | "schedule";

const statusBadgeClass = STATUS_BADGE_CLASS;

/* ── Props ────────────────────────────────────────────────── */
interface CampaignBuilderViewProps {
  campaignId: string;
  onBack: () => void;
}

/* ── Group data from API ──────────────────────────────────── */
interface StrategyGroup {
  id: string;
  name: string;
  description: string;
  aiReasoning?: string;
  customerCount: number;
  steps: StrategySequenceStep[];
  sortOrder: number;
  status: string;
}

/* ── Component ────────────────────────────────────────────── */
export default function CampaignBuilderView({ campaignId, onBack }: CampaignBuilderViewProps) {
  const { orgId } = useOrg();

  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [groups, setGroups] = useState<StrategyGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("steps");
  const [schedule, setSchedule] = useState<SendSchedule>({});
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [selectedTask, setSelectedTask] = useState<
    (CampaignTask & { email_campaigns?: { id?: string; name?: string; campaign_category?: string } }) | null
  >(null);
  const [taskCount, setTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);

  /* ── Load campaign + steps + schedule ───────────────────── */
  const loadCampaign = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    try {
      const [stepsRes, scheduleRes, tasksRes] = await Promise.all([
        fetch(`/api/campaigns/${campaignId}/steps`),
        fetch(`/api/campaigns/${campaignId}/schedule`),
        fetch(`/api/campaigns/${campaignId}/tasks?limit=1`),
      ]);

      // Steps / groups
      if (stepsRes.ok) {
        const data = await stepsRes.json();
        const grps = (data.groups ?? []) as StrategyGroup[];
        setGroups(grps);
        if (grps.length > 0 && !activeGroupId) {
          setActiveGroupId(grps[0].id);
          setSteps(toBuilderSteps(grps[0].steps ?? []));
        }
      }

      // Schedule
      if (scheduleRes.ok) {
        const data = await scheduleRes.json();
        setSchedule(data.schedule ?? {});
      }

      // Task count
      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTaskCount(data.total ?? 0);
      }
    } catch {
      /* silent */
    }

    // Campaign metadata (direct Supabase for speed)
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data: camp } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();
    if (camp) setCampaign(camp as EmailCampaign);

    setLoading(false);
  }, [orgId, campaignId, activeGroupId]);

  useEffect(() => { loadCampaign(); }, [loadCampaign]);

  /* ── Switch group ───────────────────────────────────────── */
  const switchGroup = (groupId: string) => {
    setActiveGroupId(groupId);
    const grp = groups.find((g) => g.id === groupId);
    if (grp) setSteps(toBuilderSteps(grp.steps ?? []));
    setSelectedStepIndex(null);
  };

  /* ── Step mutations ─────────────────────────────────────── */
  const saveStepsToServer = async (newSteps: BuilderStep[]) => {
    if (!activeGroupId) return;
    await fetch(`/api/campaigns/${campaignId}/steps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: activeGroupId,
        steps: newSteps.map((s) => ({
          step_number: s.step_number,
          delay_days: s.delay_days,
          email_type: s.email_type,
          prompt: s.prompt,
          subject_hint: s.subject_hint,
          step_type: s.step_type,
          channel: s.channel,
          task_instructions: s.task_instructions,
        })),
      }),
    });
  };

  const handleAddStep = (afterIndex: number, step: Partial<StrategySequenceStep>) => {
    const newSteps = [...steps];
    const builderStep: BuilderStep = {
      id: uid(),
      isNew: true,
      step_number: 0,
      delay_days: (step as BuilderStep).delay_days ?? 2,
      email_type: step.email_type ?? "follow_up",
      step_type: step.step_type ?? "auto_email",
      prompt: step.prompt ?? "",
      subject_hint: step.subject_hint,
      channel: step.channel,
      task_instructions: step.task_instructions,
    };

    if (afterIndex < 0) {
      newSteps.unshift(builderStep);
    } else {
      newSteps.splice(afterIndex + 1, 0, builderStep);
    }

    // Renumber
    newSteps.forEach((s, i) => { s.step_number = i + 1; });
    setSteps(newSteps);
    setSelectedStepIndex(afterIndex < 0 ? 0 : afterIndex + 1);
    saveStepsToServer(newSteps);
  };

  const handleUpdateStep = (updates: Partial<BuilderStep>) => {
    if (selectedStepIndex === null) return;
    const newSteps = [...steps];
    newSteps[selectedStepIndex] = { ...newSteps[selectedStepIndex], ...updates, isDirty: true };
    setSteps(newSteps);

    // Debounced save via PATCH
    if (!activeGroupId) return;
    fetch(`/api/campaigns/${campaignId}/steps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: activeGroupId,
        stepNumber: newSteps[selectedStepIndex].step_number,
        updates: {
          delay_days: newSteps[selectedStepIndex].delay_days,
          email_type: newSteps[selectedStepIndex].email_type,
          prompt: newSteps[selectedStepIndex].prompt,
          subject_hint: newSteps[selectedStepIndex].subject_hint,
          step_type: newSteps[selectedStepIndex].step_type,
          channel: newSteps[selectedStepIndex].channel,
          task_instructions: newSteps[selectedStepIndex].task_instructions,
        },
      }),
    });
  };

  const handleDeleteStep = () => {
    if (selectedStepIndex === null || !activeGroupId) return;
    const stepNumber = steps[selectedStepIndex].step_number;
    const newSteps = steps.filter((_, i) => i !== selectedStepIndex);
    newSteps.forEach((s, i) => { s.step_number = i + 1; });
    setSteps(newSteps);
    setSelectedStepIndex(null);

    fetch(`/api/campaigns/${campaignId}/steps`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: activeGroupId, stepNumber }),
    });
  };

  /* ── Schedule save ──────────────────────────────────────── */
  const handleSaveSchedule = async (sched: SendSchedule) => {
    setSavingSchedule(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sched),
      });
      if (res.ok) {
        const data = await res.json();
        setSchedule(data.schedule ?? sched);
      }
    } catch {
      /* silent */
    } finally {
      setSavingSchedule(false);
    }
  };

  /* ── Active group info ──────────────────────────────────── */
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const totalDays = steps.reduce((sum, s) => sum + (s.delay_days ?? 0), 0);

  if (loading) {
    return <div className="crm-loading" style={{ padding: 60, textAlign: "center" }}>Loading campaign...</div>;
  }

  return (
    <div className="cb-builder">
      {/* Header */}
      <div className="cb-builder-header">
        <div className="cb-builder-header-left">
          <button className="sv-back-btn" onClick={onBack} aria-label="Back to campaigns">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="cb-builder-name">{campaign?.name ?? "Campaign"}</h2>
            <div className="cb-builder-meta">
              <span className={`campaign-badge ${statusBadgeClass[campaign?.status ?? "draft"]}`}>
                {capitalise(campaign?.status ?? "draft")}
              </span>
              <span className={`campaign-badge ${
                campaign?.campaign_category === "sales" ? "campaign-badge-purple" : "campaign-badge-blue"
              }`}>
                {capitalise(campaign?.campaign_category ?? "marketing")}
              </span>
            </div>
          </div>
        </div>
        <div className="cb-builder-header-stats">
          <span className="cb-builder-stat">{steps.length} steps</span>
          <span className="cb-builder-stat">{activeGroup?.customerCount ?? 0} customers</span>
          <span className="cb-builder-stat">{totalDays} days</span>
          {taskCount > 0 && (
            <span className="cb-builder-stat cb-builder-stat-tasks">{taskCount} tasks</span>
          )}
        </div>
      </div>

      {/* Group selector (multi-group campaigns) */}
      {groups.length > 1 && (
        <div className="cb-group-selector">
          {groups.map((g) => (
            <button
              key={g.id}
              className={`cb-group-pill ${g.id === activeGroupId ? "cb-group-pill-active" : ""}`}
              onClick={() => switchGroup(g.id)}
            >
              {g.name}
              <span className="cb-group-pill-count">{g.customerCount}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="data-tabs">
        {(["steps", "flow", "review", "tasks", "schedule"] as BuilderTab[]).map((tab) => (
          <button
            key={tab}
            className={`data-tab ${activeTab === tab ? "data-tab-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "steps" ? "Steps" :
             tab === "flow" ? "Flow" :
             tab === "review" ? `Review (${campaign?.total_variants ?? 0})` :
             tab === "tasks" ? `Tasks (${taskCount})` :
             "Schedule"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="cb-builder-content">
        {/* Steps tab */}
        {activeTab === "steps" && (
          <div className="cb-split-pane">
            <div className="cb-split-left">
              <StepList
                steps={steps}
                selectedIndex={selectedStepIndex}
                onSelect={setSelectedStepIndex}
                onAddStep={handleAddStep}
              />
            </div>
            {selectedStepIndex !== null && steps[selectedStepIndex] && (
              <div className="cb-split-right">
                <StepEditorSidebar
                  step={steps[selectedStepIndex]}
                  stepIndex={selectedStepIndex}
                  onUpdate={handleUpdateStep}
                  onDelete={handleDeleteStep}
                  onClose={() => setSelectedStepIndex(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Flow tab */}
        {activeTab === "flow" && (
          <div className="cb-split-pane">
            <div className="cb-flow-pane">
              <CampaignFlowView
                steps={steps}
                selectedIndex={selectedStepIndex}
                onSelect={setSelectedStepIndex}
                groupName={activeGroup?.name}
                customerCount={activeGroup?.customerCount}
              />
            </div>
            {selectedStepIndex !== null && steps[selectedStepIndex] && (
              <div className="cb-split-right">
                <StepEditorSidebar
                  step={steps[selectedStepIndex]}
                  stepIndex={selectedStepIndex}
                  onUpdate={handleUpdateStep}
                  onDelete={handleDeleteStep}
                  onClose={() => setSelectedStepIndex(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Review tab */}
        {activeTab === "review" && (
          <CampaignReviewView
            campaignId={campaignId}
            onBack={() => setActiveTab("steps")}
          />
        )}

        {/* Tasks tab */}
        {activeTab === "tasks" && (
          <>
            <TaskBoard
              campaignId={campaignId}
              onTaskSelect={(t) => setSelectedTask(t)}
            />
            {selectedTask && (
              <TaskDetailDrawer
                task={selectedTask}
                onClose={() => setSelectedTask(null)}
                onUpdate={() => {
                  setSelectedTask(null);
                  loadCampaign();
                }}
              />
            )}
          </>
        )}

        {/* Schedule tab */}
        {activeTab === "schedule" && (
          <SendScheduleEditor
            schedule={schedule}
            onSave={handleSaveSchedule}
            saving={savingSchedule}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="cb-builder-bottom">
        <button
          className="btn btn-secondary"
          onClick={onBack}
        >
          Back to Campaigns
        </button>
        <div className="cb-builder-bottom-right">
          {campaign?.status === "draft" && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await fetch(`/api/campaigns/generate`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ campaignId }),
                });
                loadCampaign();
              }}
            >
              Generate Emails
            </button>
          )}
          {(campaign?.status === "approved" || campaign?.status === "review") &&
            (campaign?.approved_count ?? 0) > 0 && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await fetch(`/api/campaigns/${campaignId}/send`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ confirmed: true }),
                });
                loadCampaign();
              }}
            >
              Send Campaign ({campaign.approved_count})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
