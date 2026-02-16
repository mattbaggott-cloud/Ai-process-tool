-- ============================================================
-- 007_data_home.sql  –  Data Home: Connectors, Imports, Sync Log
-- ============================================================

-- ── data_connectors ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_connectors (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_type  TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','connected','error','coming_soon')),
  config          JSONB DEFAULT '{}'::jsonb,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_connectors_user
  ON data_connectors(user_id);
CREATE INDEX IF NOT EXISTS idx_data_connectors_user_type
  ON data_connectors(user_id, connector_type);

ALTER TABLE data_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own connectors" ON data_connectors
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── data_imports ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_imports (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id    UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  source_name     TEXT NOT NULL DEFAULT '',
  target_table    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','mapping','importing','completed','failed')),
  total_rows      INTEGER DEFAULT 0,
  imported_rows   INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  mapped_fields   JSONB DEFAULT '[]'::jsonb,
  errors          JSONB DEFAULT '[]'::jsonb,
  file_preview    JSONB DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_imports_user
  ON data_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_data_imports_user_status
  ON data_imports(user_id, status);

ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own imports" ON data_imports
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── data_sync_log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_sync_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id    UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  import_id       UUID REFERENCES data_imports(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL DEFAULT 'info'
                    CHECK (event_type IN ('info','warning','error','success')),
  message         TEXT NOT NULL DEFAULT '',
  details         JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_sync_log_user_time
  ON data_sync_log(user_id, created_at DESC);

ALTER TABLE data_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sync log" ON data_sync_log
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
