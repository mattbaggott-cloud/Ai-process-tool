-- Migration 041: Add timezone to user_profiles
--
-- Stores the user's IANA timezone (e.g. 'America/New_York', 'Europe/London').
-- Auto-detected from the browser via Intl.DateTimeFormat and persisted on login.
-- Used by the AI copilot for accurate time display in calendar, emails, etc.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
