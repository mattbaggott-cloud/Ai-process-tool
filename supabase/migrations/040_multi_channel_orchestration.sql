-- Migration 040: Multi-Channel Campaign Orchestration
--
-- Evolves the campaign system from single-channel email-only to multi-channel
-- orchestration. Adds campaign_tasks table for manual steps (phone calls,
-- LinkedIn, manual email review). Widens email_campaigns constraints for
-- new delivery channels, execution modes, and the 'cancelled' status.

/* ══════════════════════════════════════════════════════════════════
   1. campaign_tasks — task queue for manual / non-email steps
   ══════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS campaign_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id       UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  variant_id        UUID REFERENCES email_customer_variants(id) ON DELETE SET NULL,
  strategy_group_id UUID REFERENCES campaign_strategy_groups(id) ON DELETE SET NULL,

  -- Step context
  step_number       INTEGER NOT NULL DEFAULT 1,
  step_type         TEXT NOT NULL DEFAULT 'manual_email'
                    CHECK (step_type IN (
                      'auto_email', 'manual_email', 'phone_call',
                      'linkedin_view', 'linkedin_connect', 'linkedin_message',
                      'custom_task'
                    )),

  -- Target contact info (denormalized for task list display)
  ecom_customer_id  UUID REFERENCES ecom_customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  customer_name     TEXT,

  -- Assignment & instructions
  assigned_to       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  instructions      TEXT,

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  due_at            TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  completed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_tasks_org
  ON campaign_tasks(org_id);

CREATE INDEX IF NOT EXISTS idx_campaign_tasks_campaign
  ON campaign_tasks(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_tasks_assigned_status
  ON campaign_tasks(assigned_to, status)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_campaign_tasks_due
  ON campaign_tasks(due_at)
  WHERE status = 'pending';

-- RLS
ALTER TABLE campaign_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_tasks_org_access" ON campaign_tasks
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );


/* ══════════════════════════════════════════════════════════════════
   2. ALTER email_campaigns — new column + widened constraints
   ══════════════════════════════════════════════════════════════════ */

-- 2a. Add execution_mode column
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'automatic'
  CHECK (execution_mode IN ('manual', 'automatic'));

-- 2b. Widen delivery_channel CHECK to include gmail + outreach
--     Old: ('klaviyo', 'mailchimp', 'sendgrid', 'salesloft')
ALTER TABLE email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_delivery_channel_check;

ALTER TABLE email_campaigns ADD CONSTRAINT email_campaigns_delivery_channel_check
  CHECK (delivery_channel IN (
    'klaviyo', 'mailchimp', 'sendgrid', 'salesloft',
    'gmail', 'outreach'
  ));

-- 2c. Widen status CHECK to include 'cancelled'
--     Old: ('draft','generating','review','approved','sending','sent','paused','failed')
ALTER TABLE email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_status_check;

ALTER TABLE email_campaigns ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN (
    'draft', 'generating', 'review', 'approved',
    'sending', 'sent', 'paused', 'failed', 'cancelled'
  ));
