-- ============================================================
-- 023: Klaviyo Connector
-- Lists, profiles, campaigns, and campaign metrics from Klaviyo
-- ============================================================

-- ── Klaviyo Lists ──
CREATE TABLE IF NOT EXISTS klaviyo_lists (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_source TEXT NOT NULL DEFAULT 'klaviyo',
  name            TEXT NOT NULL,
  list_type       TEXT NOT NULL DEFAULT 'list'
                  CHECK (list_type IN ('list', 'segment')),
  member_count    INTEGER DEFAULT 0,
  metadata        JSONB DEFAULT '{}'::jsonb,
  synced_at       TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, external_id, external_source)
);

-- ── Klaviyo Profiles (Subscribers) ──
CREATE TABLE IF NOT EXISTS klaviyo_profiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_source TEXT NOT NULL DEFAULT 'klaviyo',
  email           TEXT,
  phone_number    TEXT,
  first_name      TEXT,
  last_name       TEXT,
  organization    TEXT,
  title           TEXT,
  city            TEXT,
  region          TEXT,
  country         TEXT,
  zip             TEXT,
  properties      JSONB DEFAULT '{}'::jsonb,  -- custom Klaviyo properties
  klaviyo_created_at TIMESTAMPTZ,
  klaviyo_updated_at TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, external_id, external_source)
);

-- ── Klaviyo Campaigns ──
CREATE TABLE IF NOT EXISTS klaviyo_campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_source TEXT NOT NULL DEFAULT 'klaviyo',
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  archived        BOOLEAN DEFAULT false,
  audiences       JSONB DEFAULT '{}'::jsonb,
  send_options    JSONB DEFAULT '{}'::jsonb,
  tracking_options JSONB DEFAULT '{}'::jsonb,
  send_strategy   JSONB DEFAULT '{}'::jsonb,
  scheduled_at    TIMESTAMPTZ,
  klaviyo_created_at TIMESTAMPTZ,
  klaviyo_updated_at TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, external_id, external_source)
);

-- ── Klaviyo Campaign Metrics (Performance Data) ──
CREATE TABLE IF NOT EXISTS klaviyo_campaign_metrics (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  klaviyo_campaign_id UUID NOT NULL REFERENCES klaviyo_campaigns(id) ON DELETE CASCADE,
  recipients          INTEGER DEFAULT 0,
  deliveries          INTEGER DEFAULT 0,
  delivery_rate       NUMERIC(5,4) DEFAULT 0,
  opens               INTEGER DEFAULT 0,
  unique_opens        INTEGER DEFAULT 0,
  open_rate           NUMERIC(5,4) DEFAULT 0,
  clicks              INTEGER DEFAULT 0,
  unique_clicks       INTEGER DEFAULT 0,
  click_rate          NUMERIC(5,4) DEFAULT 0,
  bounces             INTEGER DEFAULT 0,
  bounce_rate         NUMERIC(5,4) DEFAULT 0,
  unsubscribes        INTEGER DEFAULT 0,
  unsubscribe_rate    NUMERIC(5,4) DEFAULT 0,
  spam_complaints     INTEGER DEFAULT 0,
  revenue             NUMERIC(12,2) DEFAULT 0,
  synced_at           TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(klaviyo_campaign_id)
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_klaviyo_lists_org ON klaviyo_lists(org_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_profiles_org ON klaviyo_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_profiles_email ON klaviyo_profiles(org_id, email);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_org ON klaviyo_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_status ON klaviyo_campaigns(org_id, status);
CREATE INDEX IF NOT EXISTS idx_klaviyo_metrics_campaign ON klaviyo_campaign_metrics(klaviyo_campaign_id);

-- ── RLS ──
ALTER TABLE klaviyo_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "klaviyo_lists_org_access" ON klaviyo_lists
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "klaviyo_profiles_org_access" ON klaviyo_profiles
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "klaviyo_campaigns_org_access" ON klaviyo_campaigns
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "klaviyo_campaign_metrics_org_access" ON klaviyo_campaign_metrics
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
