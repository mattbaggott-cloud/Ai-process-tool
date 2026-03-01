-- ============================================================
-- Migration 036: Sales Cadences
-- Multi-step, multi-channel B2B outreach sequences
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft',
  target_persona TEXT NOT NULL DEFAULT '',
  total_steps INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 0,
  channels TEXT[] DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sales_cadences_org
  ON sales_cadences(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_cadences_user
  ON sales_cadences(user_id, updated_at DESC);

-- RLS
ALTER TABLE sales_cadences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sales_cadences' AND policyname = 'Users manage own cadences'
  ) THEN
    CREATE POLICY "Users manage own cadences"
      ON sales_cadences FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;
