-- ============================================================
-- 008_crm_custom_fields.sql  –  Custom Field Definitions for CRM
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_custom_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL CHECK (table_name IN (
                'crm_contacts', 'crm_companies', 'crm_deals', 'crm_activities'
              )),
  field_key   TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text'
              CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  is_required BOOLEAN DEFAULT false,
  options     JSONB DEFAULT '[]'::jsonb,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_custom_fields_unique
  ON crm_custom_fields(user_id, table_name, field_key);

CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_user_table
  ON crm_custom_fields(user_id, table_name, sort_order);

ALTER TABLE crm_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own custom fields" ON crm_custom_fields
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
