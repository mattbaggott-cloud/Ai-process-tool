-- ============================================================
-- 009_crm_reports.sql  –  Saved CRM Reports
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  entity_type   TEXT NOT NULL CHECK (entity_type IN (
                  'contacts', 'companies', 'deals', 'activities'
                )),

  -- Which columns are visible and in what order
  -- Array of column keys: ["first_name","last_name","email","status"]
  columns       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Array of filter objects: [{"field":"status","operator":"is","value":"active"}]
  filters       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Sort config: {"field":"created_at","direction":"desc"}
  sort_config   JSONB DEFAULT '{"field":"created_at","direction":"desc"}'::jsonb,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_reports_user
  ON crm_reports(user_id, created_at DESC);

ALTER TABLE crm_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own reports" ON crm_reports
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
