-- Campaign Strategy Groups
-- Middle layer between segments and email variants.
-- Each group represents a sub-segment within a campaign with its own
-- messaging strategy, sequence, and AI reasoning.

CREATE TABLE campaign_strategy_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  group_description TEXT,
  ai_reasoning TEXT,
  filter_criteria JSONB NOT NULL DEFAULT '{}',
  customer_ids UUID[] DEFAULT '{}',
  customer_count INTEGER DEFAULT 0,
  sequence_steps JSONB DEFAULT '[]',
  total_emails INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','generating','review','sent')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_strategy_groups_campaign ON campaign_strategy_groups(campaign_id);
CREATE INDEX idx_strategy_groups_org ON campaign_strategy_groups(org_id);

-- RLS
ALTER TABLE campaign_strategy_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_groups_org_access" ON campaign_strategy_groups
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Add strategy columns to existing tables
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS has_strategy BOOLEAN DEFAULT false;

ALTER TABLE email_customer_variants ADD COLUMN IF NOT EXISTS strategy_group_id UUID REFERENCES campaign_strategy_groups(id);
ALTER TABLE email_customer_variants ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_variants_strategy_group ON email_customer_variants(strategy_group_id);
