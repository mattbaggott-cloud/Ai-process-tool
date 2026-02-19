-- ============================================================
-- 024: Identity Resolution Staging Tables + Waterfall Support
--
-- Adds staged identity resolution with human-in-the-loop review:
--   1. identity_resolution_runs — tracks each resolution execution
--   2. identity_match_candidates — individual match candidates for review
--
-- Also expands the customer_identity_links match_type CHECK constraint
-- to support new waterfall matching tiers.
-- ============================================================

-- ── identity_resolution_runs ────────────────────────────────

CREATE TABLE IF NOT EXISTS identity_resolution_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending_review'
               CHECK (status IN ('pending_review', 'applied', 'partially_applied', 'reversed')),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at   TIMESTAMPTZ,
  reversed_at  TIMESTAMPTZ,
  stats        JSONB NOT NULL DEFAULT '{}',  -- { total_candidates, by_tier: {1: 12, 3: 3}, duration_ms }
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_resolution_runs_org ON identity_resolution_runs(org_id);
CREATE INDEX idx_resolution_runs_status ON identity_resolution_runs(org_id, status);

ALTER TABLE identity_resolution_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view resolution runs"
  ON identity_resolution_runs FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert resolution runs"
  ON identity_resolution_runs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update resolution runs"
  ON identity_resolution_runs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));


-- ── identity_match_candidates ───────────────────────────────

CREATE TABLE IF NOT EXISTS identity_match_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES identity_resolution_runs(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Source A (the "left" record)
  source_a_type   TEXT NOT NULL,       -- e.g. 'crm_contacts', 'ecom_customers', 'klaviyo_profiles'
  source_a_id     UUID NOT NULL,
  source_a_label  TEXT NOT NULL,       -- display name

  -- Source B (the "right" record)
  source_b_type   TEXT NOT NULL,
  source_b_id     UUID NOT NULL,
  source_b_label  TEXT NOT NULL,

  -- Match details
  match_tier      INT NOT NULL CHECK (match_tier BETWEEN 1 AND 6),
  confidence      FLOAT NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  match_signals   TEXT[] NOT NULL DEFAULT '{}',   -- e.g. ['email'] or ['first_name','last_name','company']
  matched_on      TEXT,                            -- the actual matching value(s)
  needs_review    BOOLEAN NOT NULL DEFAULT false,

  -- Review status
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),

  -- Edge reference (set after apply)
  graph_edge_id   UUID REFERENCES graph_edges(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_candidates_run ON identity_match_candidates(run_id);
CREATE INDEX idx_match_candidates_org ON identity_match_candidates(org_id);
CREATE INDEX idx_match_candidates_status ON identity_match_candidates(run_id, status);
CREATE INDEX idx_match_candidates_tier ON identity_match_candidates(run_id, match_tier);

ALTER TABLE identity_match_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view match candidates"
  ON identity_match_candidates FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert match candidates"
  ON identity_match_candidates FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update match candidates"
  ON identity_match_candidates FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));


-- ── Expand customer_identity_links match_type ───────────────

ALTER TABLE customer_identity_links DROP CONSTRAINT IF EXISTS customer_identity_links_match_type_check;
ALTER TABLE customer_identity_links ADD CONSTRAINT customer_identity_links_match_type_check
  CHECK (match_type IN ('email_exact', 'phone_match', 'name_company', 'name_email_domain', 'name_city', 'name_only', 'manual'));


-- ── Add confidence index on graph_edges ─────────────────────

CREATE INDEX IF NOT EXISTS idx_graph_edges_confidence
  ON graph_edges(org_id, confidence);


-- Done
