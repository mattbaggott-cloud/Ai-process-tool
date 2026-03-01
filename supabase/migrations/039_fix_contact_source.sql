-- Migration 039: Widen crm_contacts.source CHECK constraint
--
-- The original constraint (migration 003) only allows:
--   'manual' | 'import' | 'ai' | 'referral'
-- But data connectors (Gmail, Outreach, HubSpot) write their connector name
-- as the source when creating contacts. This migration widens the constraint
-- to accept all current and future connector sources.

-- Drop the old CHECK constraint
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_source_check;

-- Add widened CHECK constraint with all connector sources
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_source_check
  CHECK (source IN (
    'manual',
    'import',
    'ai',
    'referral',
    'gmail',
    'outreach',
    'hubspot',
    'shopify',
    'klaviyo',
    'google_calendar',
    'google_drive',
    'salesforce',
    'salesloft'
  ));
