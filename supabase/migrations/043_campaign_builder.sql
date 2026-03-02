-- Migration 043: Unified Campaign Builder
--
-- Unifies email_campaigns + sales_cadences into a single concept:
-- - campaign_category: 'marketing' | 'sales' tag on email_campaigns
-- - send_schedule: JSONB rules for allowed send days, hours, blocked dates
-- - Migration function to copy sales_cadences into email_campaigns
--
-- sales_cadences table is NOT dropped — kept as read-only legacy.

-- 1. Add campaign_category to distinguish sales vs marketing campaigns
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS campaign_category TEXT NOT NULL DEFAULT 'marketing';

-- Add CHECK constraint separately (IF NOT EXISTS not supported on constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_category_check'
  ) THEN
    ALTER TABLE email_campaigns
      ADD CONSTRAINT email_campaigns_category_check
      CHECK (campaign_category IN ('marketing', 'sales'));
  END IF;
END $$;

-- 2. Add send_schedule JSONB for send rules (days, hours, holidays)
-- Shape: {
--   timezone: "America/New_York",
--   send_days: [1,2,3,4,5],              -- 0=Sun..6=Sat (Mon-Fri default)
--   send_hours: { start: 9, end: 17 },   -- 24hr format, 9am-5pm
--   blocked_dates: ["2026-12-25"]         -- ISO dates to skip (holidays)
-- }
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS send_schedule JSONB DEFAULT '{}';

-- 3. Backfill existing campaigns as marketing
UPDATE email_campaigns
SET campaign_category = 'marketing'
WHERE campaign_category IS NULL OR campaign_category = 'marketing';

-- 4. Index for fast category filtering
CREATE INDEX IF NOT EXISTS idx_email_campaigns_category
  ON email_campaigns(org_id, campaign_category);

-- 5. Migration function: copy sales_cadences into email_campaigns
-- Call manually per org: SELECT migrate_sales_cadences('org-uuid-here');
CREATE OR REPLACE FUNCTION migrate_sales_cadences(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  new_campaign_id UUID;
  migrated INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT * FROM sales_cadences WHERE org_id = p_org_id
  LOOP
    -- Create campaign from cadence
    INSERT INTO email_campaigns (
      org_id, name, campaign_type, status, campaign_category,
      delivery_channel, has_strategy, execution_mode, created_by, prompt_used
    ) VALUES (
      rec.org_id,
      rec.name,
      'sequence',
      CASE rec.status
        WHEN 'Active' THEN 'approved'
        WHEN 'Paused' THEN 'paused'
        ELSE 'draft'
      END,
      'sales',
      'outreach',
      true,
      'manual',
      rec.user_id,
      rec.description
    )
    RETURNING id INTO new_campaign_id;

    -- Create strategy group with cadence steps
    INSERT INTO campaign_strategy_groups (
      org_id, campaign_id, group_name, group_description,
      sequence_steps, total_emails, sort_order, status
    ) VALUES (
      rec.org_id,
      new_campaign_id,
      COALESCE(NULLIF(rec.target_persona, ''), rec.name),
      rec.description,
      rec.steps,
      rec.total_steps,
      0,
      'draft'
    );

    migrated := migrated + 1;
  END LOOP;

  RETURN migrated;
END;
$$;

COMMENT ON COLUMN email_campaigns.campaign_category IS
  'Whether this is a marketing campaign (Klaviyo, broadcast) or sales campaign (SDR outreach, cadence). Used for filtering in the unified campaign list.';

COMMENT ON COLUMN email_campaigns.send_schedule IS
  'Send schedule rules: allowed days (0=Sun..6=Sat), hours (24hr), timezone, and blocked dates (holidays). Campaign engine defers sends outside these windows.';
