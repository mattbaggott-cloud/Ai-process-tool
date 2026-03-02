"use client";

import React, { useState } from "react";
import type { SendSchedule } from "@/lib/types/database";

/* ── Constants ────────────────────────────────────────────── */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12:00 AM" : i === 12 ? "12:00 PM" : i === 24 ? "12:00 AM (next day)" :
    i < 12 ? `${i}:00 AM` : `${i - 12}:00 PM`,
}));

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

/* ── Props ────────────────────────────────────────────────── */
interface SendScheduleEditorProps {
  schedule: SendSchedule;
  onSave: (schedule: SendSchedule) => Promise<void>;
  saving?: boolean;
}

export default function SendScheduleEditor({
  schedule,
  onSave,
  saving,
}: SendScheduleEditorProps) {
  const [local, setLocal] = useState<SendSchedule>({
    timezone: schedule.timezone ?? "America/New_York",
    send_days: schedule.send_days ?? [1, 2, 3, 4, 5],
    send_hours: schedule.send_hours ?? { start: 9, end: 17 },
    blocked_dates: schedule.blocked_dates ?? [],
  });

  const [newDate, setNewDate] = useState("");
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<SendSchedule>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  /* ── Day toggle ─────────────────────────────────────────── */
  const toggleDay = (day: number) => {
    const days = local.send_days ?? [1, 2, 3, 4, 5];
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    update({ send_days: next });
  };

  /* ── Blocked dates ──────────────────────────────────────── */
  const addBlockedDate = () => {
    if (!newDate) return;
    const dates = [...(local.blocked_dates ?? [])];
    if (!dates.includes(newDate)) {
      dates.push(newDate);
      dates.sort();
      update({ blocked_dates: dates });
    }
    setNewDate("");
  };

  const removeBlockedDate = (date: string) => {
    update({ blocked_dates: (local.blocked_dates ?? []).filter((d) => d !== date) });
  };

  /* ── Save ───────────────────────────────────────────────── */
  const handleSave = async () => {
    await onSave(local);
    setDirty(false);
  };

  const sendDays = local.send_days ?? [1, 2, 3, 4, 5];
  const sendHours = local.send_hours ?? { start: 9, end: 17 };

  return (
    <div className="cb-schedule-editor">
      <h3 className="cb-schedule-title">Send Schedule</h3>
      <p className="cb-schedule-desc">
        Configure when campaign emails and tasks are allowed to be sent.
        Sends outside these windows will be deferred to the next valid slot.
      </p>

      {/* Timezone */}
      <div className="cb-editor-field">
        <label className="cb-editor-label">Timezone</label>
        <select
          className="cb-editor-select"
          value={local.timezone ?? "America/New_York"}
          onChange={(e) => update({ timezone: e.target.value })}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Send Days */}
      <div className="cb-editor-field">
        <label className="cb-editor-label">Send Days</label>
        <div className="cb-schedule-days">
          {DAY_LABELS.map((label, i) => (
            <button
              key={i}
              className={`cb-schedule-day-btn ${sendDays.includes(i) ? "cb-schedule-day-active" : ""}`}
              onClick={() => toggleDay(i)}
              aria-pressed={sendDays.includes(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Send Hours */}
      <div className="cb-editor-field">
        <label className="cb-editor-label">Send Hours</label>
        <div className="cb-schedule-hours">
          <select
            className="cb-editor-select cb-editor-select-sm"
            value={sendHours.start}
            onChange={(e) => update({ send_hours: { ...sendHours, start: parseInt(e.target.value) } })}
          >
            {HOUR_OPTIONS.filter((h) => h.value < 24).map((h) => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>
          <span className="cb-schedule-hours-sep">to</span>
          <select
            className="cb-editor-select cb-editor-select-sm"
            value={sendHours.end}
            onChange={(e) => update({ send_hours: { ...sendHours, end: parseInt(e.target.value) } })}
          >
            {HOUR_OPTIONS.filter((h) => h.value > 0).map((h) => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>
        </div>
        {sendHours.start >= sendHours.end && (
          <p className="cb-schedule-warning">Start hour must be before end hour</p>
        )}
      </div>

      {/* Blocked Dates */}
      <div className="cb-editor-field">
        <label className="cb-editor-label">Blocked Dates (holidays, blackouts)</label>
        <div className="cb-schedule-blocked">
          {(local.blocked_dates ?? []).map((date) => (
            <div key={date} className="cb-schedule-blocked-chip">
              <span>{new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })}</span>
              <button
                className="cb-schedule-blocked-remove"
                onClick={() => removeBlockedDate(date)}
                aria-label={`Remove ${date}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="cb-schedule-add-date">
            <input
              type="date"
              className="cb-editor-input cb-editor-input-sm"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={addBlockedDate}
              disabled={!newDate}
            >
              + Add
            </button>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="cb-schedule-actions">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!dirty || saving || sendHours.start >= sendHours.end}
        >
          {saving ? "Saving..." : "Save Schedule"}
        </button>
        {!dirty && <span className="cb-schedule-saved">Schedule is up to date</span>}
      </div>
    </div>
  );
}
