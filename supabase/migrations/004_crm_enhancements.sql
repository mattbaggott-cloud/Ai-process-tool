-- ============================================================
-- CRM ENHANCEMENTS
-- Adds next_steps field to crm_deals
-- Run AFTER 003_crm_tables.sql
-- ============================================================

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS next_steps TEXT DEFAULT '';
