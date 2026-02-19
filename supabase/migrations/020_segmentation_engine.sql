-- ============================================================
-- 020: AI Segmentation Engine
-- Tables: segments, segment_members, customer_behavioral_profiles
-- ============================================================

-- ── segments ─────────────────────────────────────────────────
-- Tree-structured segment definitions with recursive rule trees
-- and branching dimensions (product preference, comm style, etc.)

CREATE TABLE IF NOT EXISTS segments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived')),
  segment_type      TEXT NOT NULL DEFAULT 'behavioral'
                    CHECK (segment_type IN ('behavioral', 'rfm', 'product_affinity', 'lifecycle', 'custom')),

  -- Recursive rule tree (JSONB):
  -- { "type": "and"|"or"|"rule",
  --   "field": "orders_count"|"avg_interval_days"|"top_product_type"|...,
  --   "operator": "gt"|"lt"|"eq"|"between"|"contains"|"in",
  --   "value": <any>,
  --   "children": [ ...sub-rules ] }
  rules             JSONB NOT NULL DEFAULT '{}',

  -- AI-discovered behavioral patterns for this segment
  behavioral_insights JSONB NOT NULL DEFAULT '{}',

  -- Tree structure for branching segments
  parent_id         UUID REFERENCES segments(id) ON DELETE SET NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  path              TEXT[] NOT NULL DEFAULT '{}',  -- materialized path for fast tree queries

  -- Sub-branch dimensions
  branch_dimension  TEXT,   -- e.g. 'product_preference', 'communication_style', 'timing'
  branch_value      TEXT,   -- e.g. 'Coffee Beans lovers', 'casual_tone', 'morning_sender'

  -- Cached count (refreshed on member assignment)
  customer_count    INTEGER NOT NULL DEFAULT 0,

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_segments_org ON segments(org_id);
CREATE INDEX idx_segments_org_status ON segments(org_id, status) WHERE status = 'active';
CREATE INDEX idx_segments_parent ON segments(org_id, parent_id);
CREATE INDEX idx_segments_path ON segments USING GIN(path);
CREATE INDEX idx_segments_type ON segments(org_id, segment_type);

-- ── segment_members ──────────────────────────────────────────
-- Assigns customers to segments with behavioral data snapshot

CREATE TABLE IF NOT EXISTS segment_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  segment_id        UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  ecom_customer_id  UUID NOT NULL REFERENCES ecom_customers(id) ON DELETE CASCADE,

  -- Per-customer behavioral data at time of assignment
  behavioral_data   JSONB NOT NULL DEFAULT '{}',

  -- Segment fit score (0-100)
  score             NUMERIC(5,2) DEFAULT 0,

  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,  -- segments can be time-bound

  UNIQUE(org_id, segment_id, ecom_customer_id)
);

CREATE INDEX idx_segment_members_org ON segment_members(org_id);
CREATE INDEX idx_segment_members_segment ON segment_members(org_id, segment_id);
CREATE INDEX idx_segment_members_customer ON segment_members(org_id, ecom_customer_id);
CREATE INDEX idx_segment_members_score ON segment_members(org_id, segment_id, score DESC);
CREATE INDEX idx_segment_members_behavioral ON segment_members USING GIN(behavioral_data);

-- ── customer_behavioral_profiles ─────────────────────────────
-- Pre-computed behavioral analytics per customer (refreshed periodically)

CREATE TABLE IF NOT EXISTS customer_behavioral_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  ecom_customer_id        UUID NOT NULL REFERENCES ecom_customers(id) ON DELETE CASCADE,

  -- Purchase interval analysis
  purchase_intervals_days NUMERIC[] DEFAULT '{}',       -- array of day-gaps between orders
  avg_interval_days       NUMERIC(8,2),
  interval_stddev         NUMERIC(8,2),
  interval_trend          TEXT CHECK (interval_trend IN (
                            'accelerating', 'stable', 'decelerating', 'erratic', 'insufficient_data'
                          )),
  predicted_next_purchase TIMESTAMPTZ,
  days_until_predicted    INTEGER,

  -- Product affinity
  product_affinities      JSONB NOT NULL DEFAULT '[]',
  -- [ { "product_title": "...", "product_type": "...", "purchase_count": 3, "pct_of_orders": 0.6 } ]
  top_product_type        TEXT,
  top_product_title       TEXT,

  -- Enhanced scoring (RFM + velocity + consistency)
  recency_score           INTEGER,            -- 1-5 (5 = most recent)
  frequency_score         INTEGER,            -- 1-5 (5 = most frequent)
  monetary_score          INTEGER,            -- 1-5 (5 = highest spend)
  velocity_score          INTEGER,            -- 1-5 (5 = accelerating fastest)
  consistency_score       NUMERIC(3,2),       -- 0-1 (1 = perfectly regular)
  engagement_score        NUMERIC(3,2),       -- 0-1 composite score

  -- Lifecycle stage
  lifecycle_stage         TEXT CHECK (lifecycle_stage IN (
                            'new', 'active', 'loyal', 'at_risk', 'lapsed', 'win_back', 'champion'
                          )),

  -- Communication preferences (AI-inferred)
  inferred_comm_style     TEXT CHECK (inferred_comm_style IN (
                            'casual', 'data_driven', 'aspirational', 'urgency_responsive', 'social_proof', 'unknown'
                          )),

  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(org_id, ecom_customer_id)
);

CREATE INDEX idx_behavioral_profiles_org ON customer_behavioral_profiles(org_id);
CREATE INDEX idx_behavioral_profiles_customer ON customer_behavioral_profiles(org_id, ecom_customer_id);
CREATE INDEX idx_behavioral_profiles_lifecycle ON customer_behavioral_profiles(org_id, lifecycle_stage);
CREATE INDEX idx_behavioral_profiles_engagement ON customer_behavioral_profiles(org_id, engagement_score DESC);
CREATE INDEX idx_behavioral_profiles_predicted ON customer_behavioral_profiles(org_id, predicted_next_purchase);
CREATE INDEX idx_behavioral_profiles_product ON customer_behavioral_profiles(org_id, top_product_type);

-- ── RLS Policies ─────────────────────────────────────────────

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_behavioral_profiles ENABLE ROW LEVEL SECURITY;

-- segments
CREATE POLICY "Org members can read segments"
  ON segments FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert segments"
  ON segments FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update segments"
  ON segments FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can delete segments"
  ON segments FOR DELETE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- segment_members
CREATE POLICY "Org members can read segment_members"
  ON segment_members FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert segment_members"
  ON segment_members FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update segment_members"
  ON segment_members FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can delete segment_members"
  ON segment_members FOR DELETE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- customer_behavioral_profiles
CREATE POLICY "Org members can read behavioral_profiles"
  ON customer_behavioral_profiles FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert behavioral_profiles"
  ON customer_behavioral_profiles FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update behavioral_profiles"
  ON customer_behavioral_profiles FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can delete behavioral_profiles"
  ON customer_behavioral_profiles FOR DELETE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
