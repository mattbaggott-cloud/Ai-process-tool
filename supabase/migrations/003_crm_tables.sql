-- ============================================================
-- CRM MODULE MIGRATION
-- Tables: crm_companies, crm_contacts, crm_deals, crm_activities
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. CRM COMPANIES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_companies (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  domain        TEXT DEFAULT '',
  industry      TEXT DEFAULT '',
  size          TEXT DEFAULT '' CHECK (size IN ('', 'startup', 'small', 'medium', 'large', 'enterprise')),
  description   TEXT DEFAULT '',
  website       TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  metadata      JSONB DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_companies_user ON crm_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_name ON crm_companies(user_id, name);

ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own companies"
  ON crm_companies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own companies"
  ON crm_companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own companies"
  ON crm_companies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own companies"
  ON crm_companies FOR DELETE USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 2. CRM CONTACTS
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_contacts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES crm_companies(id) ON DELETE SET NULL,

  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  email         TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  title         TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'active', 'inactive', 'churned')),
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai', 'referral')),
  notes         TEXT DEFAULT '',
  tags          TEXT[] DEFAULT '{}',
  metadata      JSONB DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_user ON crm_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(user_id, email);

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own contacts"
  ON crm_contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts"
  ON crm_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts"
  ON crm_contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts"
  ON crm_contacts FOR DELETE USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 3. CRM DEALS
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_deals (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id          UUID REFERENCES crm_companies(id) ON DELETE SET NULL,

  title               TEXT NOT NULL,
  value               NUMERIC(12, 2) DEFAULT 0,
  currency            TEXT DEFAULT 'USD',
  stage               TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  probability         INTEGER DEFAULT 10 CHECK (probability >= 0 AND probability <= 100),
  expected_close_date DATE,
  notes               TEXT DEFAULT '',
  metadata            JSONB DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON crm_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_company ON crm_deals(company_id);

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deals"
  ON crm_deals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deals"
  ON crm_deals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own deals"
  ON crm_deals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own deals"
  ON crm_deals FOR DELETE USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 4. CRM ACTIVITIES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_activities (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  deal_id         UUID REFERENCES crm_deals(id) ON DELETE SET NULL,

  type            TEXT NOT NULL DEFAULT 'note' CHECK (type IN ('call', 'email', 'meeting', 'note', 'task')),
  subject         TEXT NOT NULL DEFAULT '',
  description     TEXT DEFAULT '',
  scheduled_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_user ON crm_activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id);

ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activities"
  ON crm_activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activities"
  ON crm_activities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own activities"
  ON crm_activities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own activities"
  ON crm_activities FOR DELETE USING (auth.uid() = user_id);


-- ============================================================
-- DONE! Run this in your Supabase SQL Editor.
-- ============================================================
