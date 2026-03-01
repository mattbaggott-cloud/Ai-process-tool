-- ============================================================
-- Migration 035: Chat Sessions
-- Database-backed conversation history for AI copilot
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for sidebar listing (most recent first)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON chat_sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_org
  ON chat_sessions(org_id, updated_at DESC);

-- RLS: users can only access their own sessions
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_sessions' AND policyname = 'Users manage own sessions'
  ) THEN
    CREATE POLICY "Users manage own sessions"
      ON chat_sessions FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;
