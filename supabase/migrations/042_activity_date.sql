-- Migration 042: Add activity_date to crm_activities
--
-- Problem: crm_activities had no canonical "when did this happen" field.
-- scheduled_at is for future events, completed_at is when it was marked done,
-- created_at is when the row was inserted. None of these represent the actual
-- date the activity occurred — so logging "I had a call on Feb 25" stored
-- the date as the current timestamp instead.
--
-- Fix: Add activity_date as the primary date field. Default to now() so
-- existing rows and new rows without an explicit date still work.

ALTER TABLE crm_activities
  ADD COLUMN IF NOT EXISTS activity_date TIMESTAMPTZ DEFAULT now();

-- Backfill existing rows: use completed_at if set, then scheduled_at, then created_at
UPDATE crm_activities
SET activity_date = COALESCE(completed_at, scheduled_at, created_at)
WHERE activity_date IS NULL OR activity_date = created_at;

-- Index for date-range queries (most common: "recent activity for X")
CREATE INDEX IF NOT EXISTS idx_crm_activities_date
  ON crm_activities(org_id, activity_date DESC);

COMMENT ON COLUMN crm_activities.activity_date IS
  'The date/time the activity actually occurred or is planned for. This is the primary date field for sorting and display.';
