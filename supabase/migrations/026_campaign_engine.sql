-- ============================================================
-- Migration 026: AI Campaign Engine
-- Provider-agnostic campaign orchestration with per-customer
-- email generation, broadcast, and sequence support.
-- ============================================================

-- ── email_campaigns ─────────────────────────────────────────
-- Parent record for any campaign (per_customer, broadcast, sequence)
CREATE TABLE IF NOT EXISTS email_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  campaign_type     TEXT NOT NULL DEFAULT 'per_customer'
                    CHECK (campaign_type IN ('per_customer', 'broadcast', 'sequence')),
  segment_id        UUID REFERENCES segments(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'generating', 'review', 'approved', 'sending', 'sent', 'paused', 'failed')),
  email_type        TEXT NOT NULL DEFAULT 'promotional'
                    CHECK (email_type IN ('promotional', 'win_back', 'nurture', 'announcement', 'welcome', 'follow_up', 'custom')),
  prompt_used       TEXT,
  delivery_channel  TEXT NOT NULL DEFAULT 'klaviyo'
                    CHECK (delivery_channel IN ('klaviyo', 'mailchimp', 'sendgrid', 'salesloft')),
  delivery_config   JSONB DEFAULT '{}'::jsonb,
  template_id       UUID REFERENCES email_brand_assets(id) ON DELETE SET NULL,
  total_variants    INTEGER NOT NULL DEFAULT 0,
  approved_count    INTEGER NOT NULL DEFAULT 0,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  stats             JSONB DEFAULT '{}'::jsonb,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_email_campaigns_org ON email_campaigns(org_id);
CREATE INDEX idx_email_campaigns_org_status ON email_campaigns(org_id, status);
CREATE INDEX idx_email_campaigns_segment ON email_campaigns(segment_id);

-- RLS
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_campaigns_org_access" ON email_campaigns
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );


-- ── email_customer_variants ─────────────────────────────────
-- One row per customer per campaign — holds the generated email
CREATE TABLE IF NOT EXISTS email_customer_variants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id             UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  ecom_customer_id        UUID REFERENCES ecom_customers(id) ON DELETE SET NULL,
  customer_email          TEXT NOT NULL,
  customer_name           TEXT,
  subject_line            TEXT,
  preview_text            TEXT,
  body_html               TEXT,
  body_text               TEXT,
  personalization_context JSONB DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved', 'edited', 'rejected', 'sending', 'sent', 'failed')),
  edited_content          JSONB,
  delivery_id             TEXT,
  delivery_status         TEXT DEFAULT 'pending'
                          CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  delivery_metrics        JSONB DEFAULT '{}'::jsonb,
  reviewed_at             TIMESTAMPTZ,
  sent_at                 TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  opened_at               TIMESTAMPTZ,
  clicked_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_email_variants_org ON email_customer_variants(org_id);
CREATE INDEX idx_email_variants_campaign ON email_customer_variants(campaign_id);
CREATE INDEX idx_email_variants_campaign_status ON email_customer_variants(campaign_id, status);
CREATE INDEX idx_email_variants_customer ON email_customer_variants(ecom_customer_id);
CREATE INDEX idx_email_variants_delivery ON email_customer_variants(delivery_status);
CREATE INDEX idx_email_variants_email ON email_customer_variants(customer_email);

-- RLS
ALTER TABLE email_customer_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_customer_variants_org_access" ON email_customer_variants
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );


-- ── email_sequence_steps ────────────────────────────────────
-- For multi-step cadences: each step is a sub-campaign
CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id       UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number       INTEGER NOT NULL,
  delay_days        INTEGER NOT NULL DEFAULT 0,
  email_type        TEXT NOT NULL DEFAULT 'follow_up'
                    CHECK (email_type IN ('promotional', 'win_back', 'nurture', 'announcement', 'welcome', 'follow_up', 'custom')),
  prompt            TEXT,
  subject_template  TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'generating', 'review', 'sending', 'sent')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, step_number)
);

-- Indexes
CREATE INDEX idx_email_sequence_org ON email_sequence_steps(org_id);
CREATE INDEX idx_email_sequence_campaign ON email_sequence_steps(campaign_id);

-- RLS
ALTER TABLE email_sequence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sequence_steps_org_access" ON email_sequence_steps
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
