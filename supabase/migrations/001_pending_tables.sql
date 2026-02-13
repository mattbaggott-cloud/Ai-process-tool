-- ============================================================
-- PENDING MIGRATIONS — Run in Supabase SQL Editor
-- Tables: user_profiles, pain_points, dashboards
-- Column: projects.chat_messages
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. USER PROFILES TABLE
-- Extended user context for AI copilot personalization
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL DEFAULT '',
  job_title     TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  areas_of_expertise TEXT[] DEFAULT '{}',
  years_of_experience TEXT NOT NULL DEFAULT '',
  decision_authority  TEXT NOT NULL DEFAULT '',
  communication_preferences TEXT NOT NULL DEFAULT '',
  key_responsibilities TEXT NOT NULL DEFAULT '',
  focus_areas   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE
  USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 2. PAIN POINTS TABLE
-- Track organizational pain points linked to goals
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pain_points (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  severity        TEXT NOT NULL DEFAULT 'Medium',
  status          TEXT NOT NULL DEFAULT 'Backlog',
  teams           TEXT[] DEFAULT '{}',
  owner           TEXT NOT NULL DEFAULT '',
  impact_metric   TEXT NOT NULL DEFAULT '',
  linked_goal_id  UUID REFERENCES goals(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE pain_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pain points"
  ON pain_points FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pain points"
  ON pain_points FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pain points"
  ON pain_points FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pain points"
  ON pain_points FOR DELETE
  USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 3. CHAT MESSAGES COLUMN ON PROJECTS
-- Persist per-project AI chat history as JSONB
-- ────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS chat_messages JSONB DEFAULT '[]'::jsonb;


-- ────────────────────────────────────────────────────────────
-- 4. DASHBOARDS TABLE
-- Configurable widget dashboards per user
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dashboards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'My Dashboard',
  widgets     JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dashboards"
  ON dashboards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dashboards"
  ON dashboards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dashboards"
  ON dashboards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own dashboards"
  ON dashboards FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- DONE! All 4 migrations applied.
-- Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   ORDER BY table_name;
-- ============================================================
