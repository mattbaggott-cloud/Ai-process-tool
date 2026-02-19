-- ============================================================
-- 025: Fix Klaviyo table FK constraints
-- The org_id columns incorrectly referenced auth.users(id)
-- instead of orgs(id). This fixes the FK to point to the
-- correct orgs table for proper multi-tenancy.
-- ============================================================

-- ── Fix klaviyo_lists ──
ALTER TABLE klaviyo_lists DROP CONSTRAINT IF EXISTS klaviyo_lists_org_id_fkey;
ALTER TABLE klaviyo_lists
  ADD CONSTRAINT klaviyo_lists_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

-- ── Fix klaviyo_profiles ──
ALTER TABLE klaviyo_profiles DROP CONSTRAINT IF EXISTS klaviyo_profiles_org_id_fkey;
ALTER TABLE klaviyo_profiles
  ADD CONSTRAINT klaviyo_profiles_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

-- ── Fix klaviyo_campaigns ──
ALTER TABLE klaviyo_campaigns DROP CONSTRAINT IF EXISTS klaviyo_campaigns_org_id_fkey;
ALTER TABLE klaviyo_campaigns
  ADD CONSTRAINT klaviyo_campaigns_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

-- ── Fix klaviyo_campaign_metrics ──
ALTER TABLE klaviyo_campaign_metrics DROP CONSTRAINT IF EXISTS klaviyo_campaign_metrics_org_id_fkey;
ALTER TABLE klaviyo_campaign_metrics
  ADD CONSTRAINT klaviyo_campaign_metrics_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;
