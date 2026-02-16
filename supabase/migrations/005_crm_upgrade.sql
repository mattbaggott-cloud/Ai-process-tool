-- ================================================================
-- 005_crm_upgrade.sql
-- Enriches CRM: company fields, deal close tracking, stage history
-- ================================================================

-- ── Enhance crm_companies ──────────────────────────────────────
ALTER TABLE crm_companies
  ADD COLUMN IF NOT EXISTS annual_revenue    NUMERIC(15,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS employees         INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sic_code          TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS sector            TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_owner     TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_address   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS shipping_address  TEXT DEFAULT '';

-- ── Enhance crm_deals ──────────────────────────────────────────
ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS close_reason      TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lost_to           TEXT DEFAULT '';

-- ── Create deal stage history table ────────────────────────────
CREATE TABLE IF NOT EXISTS crm_deal_stage_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id     UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal
  ON crm_deal_stage_history(deal_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_user
  ON crm_deal_stage_history(user_id);

-- ── RLS for stage history ──────────────────────────────────────
ALTER TABLE crm_deal_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own deal stage history"
  ON crm_deal_stage_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own deal stage history"
  ON crm_deal_stage_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own deal stage history"
  ON crm_deal_stage_history FOR DELETE
  USING (auth.uid() = user_id);
