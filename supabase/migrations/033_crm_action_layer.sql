-- ============================================================
-- Migration 033: CRM Action Layer
--
-- Adds soft-delete (is_archived) to all core CRM tables and
-- enhances crm_activities with duration, outcome, updated_at.
-- This enables the AI Action Layer (Phase 5) to safely archive
-- records instead of hard-deleting them.
-- ============================================================

-- 1. Soft-delete: Add is_archived to all 4 core CRM tables
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- 2. Activity enhancements
-- duration_minutes: captures call/meeting length for sales analytics
-- outcome: captures result (e.g., "scheduled follow-up", "no answer")
-- updated_at: was missing on activities (all other CRM tables have it)
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS outcome TEXT DEFAULT '';
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Partial indexes for archive queries
-- These make WHERE is_archived = false queries fast (most common case)
CREATE INDEX IF NOT EXISTS idx_crm_contacts_archived
  ON crm_contacts(org_id, is_archived) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_crm_companies_archived
  ON crm_companies(org_id, is_archived) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_crm_deals_archived
  ON crm_deals(org_id, is_archived) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_crm_activities_archived
  ON crm_activities(org_id, is_archived) WHERE is_archived = false;
