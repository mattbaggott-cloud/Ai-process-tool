/**
 * Shared constants for campaign + task UI components.
 * Single source of truth — import from here, never duplicate.
 */

/* ── Status badge CSS class mapping ────────────────────── */
export const STATUS_BADGE_CLASS: Record<string, string> = {
  draft: "campaign-badge-gray",
  generating: "campaign-badge-blue",
  review: "campaign-badge-yellow",
  approved: "campaign-badge-green",
  sending: "campaign-badge-blue",
  sent: "campaign-badge-green",
  paused: "campaign-badge-amber",
  cancelled: "campaign-badge-red",
  failed: "campaign-badge-red",
  active: "campaign-badge-green",
  strategy_review: "campaign-badge-yellow",
  pending: "campaign-badge-yellow",
  in_progress: "campaign-badge-blue",
  completed: "campaign-badge-green",
  skipped: "campaign-badge-gray",
};

/* ── Step type metadata ────────────────────────────────── */
export const STEP_TYPE_META: Record<string, { icon: string; label: string }> = {
  auto_email:        { icon: "✉️", label: "Auto Email" },
  manual_email:      { icon: "✍️", label: "Manual Email" },
  phone_call:        { icon: "📞", label: "Phone Call" },
  linkedin_view:     { icon: "👤", label: "LinkedIn View" },
  linkedin_connect:  { icon: "🔗", label: "LinkedIn Connect" },
  linkedin_message:  { icon: "📬", label: "LinkedIn Message" },
  custom_task:       { icon: "☑️", label: "Custom Task" },
  todo:              { icon: "☑️", label: "To-Do" },
  reminder:          { icon: "⏰", label: "Reminder" },
  follow_up:         { icon: "🔄", label: "Follow Up" },
  project_task:      { icon: "📁", label: "Project Task" },
  action_item:       { icon: "⚡", label: "Action Item" },
};

/* ── Channel metadata ──────────────────────────────────── */
export const CHANNEL_META: Record<string, { icon: string; color: string; label: string }> = {
  gmail:     { icon: "✉️", color: "#ea4335", label: "Gmail" },
  outreach:  { icon: "📤", color: "#5c6bc0", label: "Outreach" },
  klaviyo:   { icon: "📨", color: "#2bbd7e", label: "Klaviyo" },
};

/* ── Helpers ────────────────────────────────────────────── */
export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

let _uid = 0;
export function uid(): string {
  return `step-${Date.now()}-${++_uid}`;
}
