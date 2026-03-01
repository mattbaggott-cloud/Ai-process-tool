-- ============================================================
-- Migration 037: Onboarding
-- Per-user onboarding tracking + session type tagging
-- ============================================================

-- Track whether each user has completed onboarding (per org)
ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Tag chat sessions as 'regular' or 'onboarding'
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'regular';
-- Values: 'regular', 'onboarding'
