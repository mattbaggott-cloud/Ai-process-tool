/**
 * Migration 032: Graph Enrichment — Entity & Relation Registries
 *
 * Part of Phase 4 (Architecture Plan Part 1: Knowledge Graph Foundation).
 *
 * Creates:
 *   1. workspace_type column on orgs (b2b / b2c / hybrid)
 *   2. entity_type_registry — replaces hardcoded TABLE_MAPPINGS display names
 *   3. relation_type_registry — replaces hardcoded edge type display names
 *   4. Seed data for both registries (system defaults, org_id = NULL)
 *   5. RLS policies for both tables
 *   6. Helper RPC: get_entity_registry(), get_relation_registry()
 *
 * Design principle: The registries are the ABSTRACTION LAYER.
 *   - Source tables stay as-is (ecom_customers, crm_contacts, etc.)
 *   - Graph nodes use unified entity_type (person, company, etc.)
 *   - Registries map between source tables and unified types
 *   - Registries provide display names for the AI prompt layer
 *   - Backwards compatible: code falls back to hardcoded values if registry is empty
 */

-- ============================================================
-- 1. WORKSPACE TYPE ON ORGS
-- ============================================================

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'b2c'
  CHECK (workspace_type IN ('b2b', 'b2c', 'hybrid'));

COMMENT ON COLUMN orgs.workspace_type IS 'Controls default entity types, edge types, slash commands, and AI behavior. b2b=sales/pipeline focus, b2c=commerce/segments focus, hybrid=all.';

-- ============================================================
-- 2. ENTITY TYPE REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_type_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES orgs(id) ON DELETE CASCADE,  -- NULL = system default
  entity_type     TEXT NOT NULL,           -- unified type: 'person', 'company', 'pipeline_item', etc.
  display_name    TEXT NOT NULL,           -- singular: 'Person', 'Company'
  display_name_plural TEXT NOT NULL,       -- plural: 'People', 'Companies'
  icon            TEXT,                    -- icon identifier for UI (e.g., 'users', 'building')
  source_tables   TEXT[] NOT NULL DEFAULT '{}', -- which DB tables map to this type: '{ecom_customers,crm_contacts}'
  label_template  TEXT,                    -- template for building labels (used by graph-sync)
  description     TEXT,                    -- human-readable description for AI context
  workspace_types TEXT[] NOT NULL DEFAULT '{b2b,b2c,hybrid}', -- which workspace types show this
  sort_order      INTEGER DEFAULT 0,       -- display ordering
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, entity_type)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_entity_registry_org ON entity_type_registry(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_registry_type ON entity_type_registry(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_registry_workspace ON entity_type_registry USING GIN(workspace_types);

COMMENT ON TABLE entity_type_registry IS 'Maps unified entity types to display names, source tables, and workspace visibility. System defaults have org_id=NULL; orgs can override with org-specific rows.';

-- ============================================================
-- 3. RELATION TYPE REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS relation_type_registry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID REFERENCES orgs(id) ON DELETE CASCADE,  -- NULL = system default
  relation_type     TEXT NOT NULL,          -- 'works_at', 'purchased', 'involved_in', etc.
  display_name      TEXT NOT NULL,          -- 'works at', 'purchased from', 'involved in'
  from_entity_type  TEXT NOT NULL,          -- source: 'person'
  to_entity_type    TEXT NOT NULL,          -- target: 'company'
  description       TEXT,                   -- human-readable for AI context
  cardinality       TEXT DEFAULT 'many_to_many'
    CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
  is_directed       BOOLEAN DEFAULT true,   -- true = from→to has meaning; false = symmetric
  workspace_types   TEXT[] NOT NULL DEFAULT '{b2b,b2c,hybrid}',
  sort_order        INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, relation_type, from_entity_type, to_entity_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_relation_registry_org ON relation_type_registry(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relation_registry_type ON relation_type_registry(relation_type);
CREATE INDEX IF NOT EXISTS idx_relation_registry_from ON relation_type_registry(from_entity_type);
CREATE INDEX IF NOT EXISTS idx_relation_registry_to ON relation_type_registry(to_entity_type);
CREATE INDEX IF NOT EXISTS idx_relation_registry_workspace ON relation_type_registry USING GIN(workspace_types);

COMMENT ON TABLE relation_type_registry IS 'Defines valid relationship types between entity types, with display names and cardinality. System defaults have org_id=NULL; orgs can override.';

-- ============================================================
-- 4. RLS POLICIES
-- ============================================================

ALTER TABLE entity_type_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE relation_type_registry ENABLE ROW LEVEL SECURITY;

-- Drop first to make idempotent (safe to re-run)
DROP POLICY IF EXISTS "Anyone can read system entity types" ON entity_type_registry;
DROP POLICY IF EXISTS "Org members can read org entity types" ON entity_type_registry;
DROP POLICY IF EXISTS "Org admins can manage org entity types" ON entity_type_registry;
DROP POLICY IF EXISTS "Anyone can read system relation types" ON relation_type_registry;
DROP POLICY IF EXISTS "Org members can read org relation types" ON relation_type_registry;
DROP POLICY IF EXISTS "Org admins can manage org relation types" ON relation_type_registry;

-- Entity type registry: anyone can read system defaults (org_id IS NULL) + their own org's
CREATE POLICY "Anyone can read system entity types"
  ON entity_type_registry FOR SELECT
  USING (org_id IS NULL);

CREATE POLICY "Org members can read org entity types"
  ON entity_type_registry FOR SELECT
  USING (org_id IS NOT NULL AND user_is_org_member(org_id));

CREATE POLICY "Org admins can manage org entity types"
  ON entity_type_registry FOR ALL
  USING (org_id IS NOT NULL AND user_has_org_role(org_id, 'admin'));

-- Relation type registry: same pattern
CREATE POLICY "Anyone can read system relation types"
  ON relation_type_registry FOR SELECT
  USING (org_id IS NULL);

CREATE POLICY "Org members can read org relation types"
  ON relation_type_registry FOR SELECT
  USING (org_id IS NOT NULL AND user_is_org_member(org_id));

CREATE POLICY "Org admins can manage org relation types"
  ON relation_type_registry FOR ALL
  USING (org_id IS NOT NULL AND user_has_org_role(org_id, 'admin'));

-- ============================================================
-- 5. SEED SYSTEM DEFAULTS (org_id = NULL)
-- ============================================================

-- ── Entity Types ──

INSERT INTO entity_type_registry (org_id, entity_type, display_name, display_name_plural, icon, source_tables, label_template, description, workspace_types, sort_order)
VALUES
  -- Person: universal, replaces ecom_customers + crm_contacts + klaviyo_profiles in graph
  (NULL, 'person', 'Person', 'People', 'user',
   '{ecom_customers,crm_contacts,klaviyo_profiles}',
   '{{first_name}} {{last_name}}',
   'Any human being — customer, lead, subscriber, partner contact. Their lifecycle role lives on edges, not the node.',
   '{b2b,b2c,hybrid}', 10),

  -- Company: universal — B2B has client accounts, B2C has brand partners/vendors
  (NULL, 'company', 'Company', 'Companies', 'building',
   '{crm_companies}',
   '{{name}}',
   'Any organization — client, prospect, partner, vendor.',
   '{b2b,b2c,hybrid}', 20),

  -- Pipeline Item: universal — B2B has sales pipeline, B2C can track wholesale/partnership deals
  (NULL, 'pipeline_item', 'Pipeline Item', 'Pipeline', 'trending-up',
   '{crm_deals}',
   '{{title}}',
   'A sales opportunity moving through pipeline stages.',
   '{b2b,b2c,hybrid}', 30),

  -- Order: universal — B2C has customer orders, B2B has purchase orders/contracts
  (NULL, 'order', 'Order', 'Orders', 'shopping-cart',
   '{ecom_orders}',
   'Order #{{order_number}}',
   'A purchase transaction.',
   '{b2b,b2c,hybrid}', 40),

  -- Product: both B2B and B2C
  (NULL, 'product', 'Product', 'Products', 'package',
   '{ecom_products}',
   '{{title}}',
   'Something you sell — physical product, service, subscription.',
   '{b2b,b2c,hybrid}', 50),

  -- Activity: universal
  (NULL, 'activity', 'Activity', 'Activities', 'clock',
   '{crm_activities}',
   '{{subject}}',
   'A logged interaction — call, email, meeting, note.',
   '{b2b,b2c,hybrid}', 60),

  -- Campaign: marketing focus
  (NULL, 'campaign', 'Campaign', 'Campaigns', 'send',
   '{email_campaigns,klaviyo_campaigns}',
   '{{name}}',
   'A marketing campaign — email, SMS, social.',
   '{b2b,b2c,hybrid}', 70),

  -- Segment: marketing/analytics
  (NULL, 'segment', 'Segment', 'Segments', 'filter',
   '{segments}',
   '{{name}}',
   'A customer grouping based on criteria or behavior.',
   '{b2b,b2c,hybrid}', 80),

  -- Document: knowledge base
  (NULL, 'document', 'Document', 'Documents', 'file-text',
   '{library_files,library_items}',
   '{{title}}',
   'Uploaded file or knowledge article — sales collateral, docs, guides.',
   '{b2b,b2c,hybrid}', 90),

  -- Goal: internal planning
  (NULL, 'goal', 'Goal', 'Goals', 'target',
   '{goals}',
   '{{name}}',
   'A business objective to track progress against.',
   '{b2b,b2c,hybrid}', 100),

  -- Sub-Goal
  (NULL, 'sub_goal', 'Sub-Goal', 'Sub-Goals', 'target',
   '{sub_goals}',
   '{{name}}',
   'A sub-objective tied to a parent goal.',
   '{b2b,b2c,hybrid}', 110),

  -- Pain Point
  (NULL, 'pain_point', 'Pain Point', 'Pain Points', 'alert-triangle',
   '{pain_points}',
   '{{name}}',
   'A business challenge or blocker to address.',
   '{b2b,b2c,hybrid}', 120),

  -- Team
  (NULL, 'team', 'Team', 'Teams', 'users',
   '{teams}',
   '{{name}}',
   'An internal team or department.',
   '{b2b,b2c,hybrid}', 130),

  -- Project
  (NULL, 'project', 'Project', 'Projects', 'folder',
   '{projects}',
   '{{name}}',
   'A project or initiative.',
   '{b2b,b2c,hybrid}', 140),

  -- List (email/marketing)
  (NULL, 'list', 'List', 'Lists', 'list',
   '{klaviyo_lists}',
   '{{name}}',
   'A subscriber or audience list.',
   '{b2b,b2c,hybrid}', 150)

ON CONFLICT (org_id, entity_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  display_name_plural = EXCLUDED.display_name_plural,
  icon = EXCLUDED.icon,
  source_tables = EXCLUDED.source_tables,
  label_template = EXCLUDED.label_template,
  description = EXCLUDED.description,
  workspace_types = EXCLUDED.workspace_types,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ── Relation Types ──

INSERT INTO relation_type_registry (org_id, relation_type, display_name, from_entity_type, to_entity_type, description, cardinality, is_directed, workspace_types, sort_order)
VALUES
  -- Person ↔ Company
  (NULL, 'works_at', 'works at', 'person', 'company',
   'Person is employed at or associated with a company. Edge properties: role, title, department, status.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 10),

  -- Person → Person
  (NULL, 'manages', 'manages', 'person', 'person',
   'Person manages another person in org hierarchy.',
   'one_to_many', true, '{b2b,b2c,hybrid}', 20),

  -- Person → Pipeline Item
  (NULL, 'involved_in', 'involved in', 'person', 'pipeline_item',
   'Person is involved in a pipeline opportunity. Edge properties: role (champion, decision_maker, influencer).',
   'many_to_many', true, '{b2b,b2c,hybrid}', 30),

  -- Pipeline Item → Company
  (NULL, 'opportunity_for', 'opportunity for', 'pipeline_item', 'company',
   'A pipeline opportunity associated with a company.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 40),

  -- Person → Order
  (NULL, 'purchased', 'purchased', 'person', 'order',
   'Person placed this order.',
   'one_to_many', true, '{b2b,b2c,hybrid}', 50),

  -- Order → Product
  (NULL, 'contains', 'contains', 'order', 'product',
   'Order contains this product. Edge properties: quantity, price.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 60),

  -- Person → Campaign
  (NULL, 'received', 'received', 'person', 'campaign',
   'Person received this campaign. Edge properties: status (sent, opened, clicked, bounced).',
   'many_to_many', true, '{b2b,b2c,hybrid}', 70),

  -- Person → Segment
  (NULL, 'belongs_to', 'belongs to', 'person', 'segment',
   'Person is a member of this segment.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 80),

  -- Company → Company
  (NULL, 'parent_of', 'parent of', 'company', 'company',
   'Company is the parent organization of another company.',
   'one_to_many', true, '{b2b,b2c,hybrid}', 90),

  -- Company → Company (partner)
  (NULL, 'partner_of', 'partner of', 'company', 'company',
   'Companies have a partnership. Edge properties: tier, since.',
   'many_to_many', false, '{b2b,b2c,hybrid}', 100),

  -- Pipeline Item → Person (assignment)
  (NULL, 'assigned_to', 'assigned to', 'pipeline_item', 'person',
   'Pipeline item is assigned to this person (sales rep).',
   'many_to_one', true, '{b2b,b2c,hybrid}', 110),

  -- Company → Person (account ownership)
  (NULL, 'account_owner', 'account owner', 'company', 'person',
   'Person owns this company account.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 120),

  -- Product → Document
  (NULL, 'documented_in', 'documented in', 'product', 'document',
   'Product is documented in this file.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 130),

  -- Person → Person (identity resolution - already exists in practice)
  (NULL, 'same_person', 'same person as', 'person', 'person',
   'Identity resolution: these person records represent the same human. Edge properties: confidence, source, match_signals.',
   'many_to_many', false, '{b2b,b2c,hybrid}', 140),

  -- Activity edges
  (NULL, 'regarding_contact', 'regarding', 'activity', 'person',
   'Activity is about this person.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 150),

  (NULL, 'regarding_company', 'regarding', 'activity', 'company',
   'Activity is about this company.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 160),

  (NULL, 'regarding_deal', 'regarding', 'activity', 'pipeline_item',
   'Activity is about this pipeline item.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 170),

  -- Goal hierarchy
  (NULL, 'child_of', 'sub-goal of', 'sub_goal', 'goal',
   'Sub-goal is a child of this parent goal.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 180),

  (NULL, 'linked_to', 'linked to', 'pain_point', 'goal',
   'Pain point is linked to this goal.',
   'many_to_one', true, '{b2b,b2c,hybrid}', 190),

  -- Legacy compatibility: primary_contact and for_company (existing edge types in graph)
  (NULL, 'primary_contact', 'primary contact for', 'pipeline_item', 'person',
   'Primary contact for this pipeline item (legacy edge type from CRM sync).',
   'many_to_one', true, '{b2b,b2c,hybrid}', 200),

  (NULL, 'for_company', 'deal for', 'pipeline_item', 'company',
   'Pipeline item is for this company (legacy edge type from CRM sync).',
   'many_to_one', true, '{b2b,b2c,hybrid}', 210),

  -- Order placement (legacy: placed_by)
  (NULL, 'placed_by', 'placed by', 'order', 'person',
   'Order was placed by this person (legacy edge type from ecom sync).',
   'many_to_one', true, '{b2b,b2c,hybrid}', 220)

ON CONFLICT (org_id, relation_type, from_entity_type, to_entity_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  cardinality = EXCLUDED.cardinality,
  is_directed = EXCLUDED.is_directed,
  workspace_types = EXCLUDED.workspace_types,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ============================================================
-- 6. HELPER RPCs
-- ============================================================

/**
 * Get entity type registry for an org.
 * Merges system defaults with org-specific overrides.
 * Org overrides take precedence (same entity_type replaces system default).
 */
CREATE OR REPLACE FUNCTION get_entity_registry(
  p_org_id UUID,
  p_workspace_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  entity_type TEXT,
  display_name TEXT,
  display_name_plural TEXT,
  icon TEXT,
  source_tables TEXT[],
  label_template TEXT,
  description TEXT,
  workspace_types TEXT[],
  sort_order INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH merged AS (
    -- System defaults (org_id IS NULL)
    SELECT
      e.entity_type, e.display_name, e.display_name_plural,
      e.icon, e.source_tables, e.label_template, e.description,
      e.workspace_types, e.sort_order,
      0 AS priority  -- lower priority
    FROM entity_type_registry e
    WHERE e.org_id IS NULL AND e.is_active = true

    UNION ALL

    -- Org-specific overrides
    SELECT
      e.entity_type, e.display_name, e.display_name_plural,
      e.icon, e.source_tables, e.label_template, e.description,
      e.workspace_types, e.sort_order,
      1 AS priority  -- higher priority
    FROM entity_type_registry e
    WHERE e.org_id = p_org_id AND e.is_active = true
  ),
  deduped AS (
    SELECT DISTINCT ON (entity_type)
      entity_type, display_name, display_name_plural,
      icon, source_tables, label_template, description,
      workspace_types, sort_order
    FROM merged
    ORDER BY entity_type, priority DESC
  )
  SELECT
    d.entity_type, d.display_name, d.display_name_plural,
    d.icon, d.source_tables, d.label_template, d.description,
    d.workspace_types, d.sort_order
  FROM deduped d
  WHERE
    -- If workspace_type filter provided, only return matching types
    (p_workspace_type IS NULL OR p_workspace_type = ANY(d.workspace_types))
  ORDER BY d.sort_order;
$$;

/**
 * Get relation type registry for an org.
 * Same merge logic: system defaults + org overrides.
 */
CREATE OR REPLACE FUNCTION get_relation_registry(
  p_org_id UUID,
  p_workspace_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  relation_type TEXT,
  display_name TEXT,
  from_entity_type TEXT,
  to_entity_type TEXT,
  description TEXT,
  cardinality TEXT,
  is_directed BOOLEAN,
  workspace_types TEXT[],
  sort_order INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH merged AS (
    SELECT
      r.relation_type, r.display_name, r.from_entity_type, r.to_entity_type,
      r.description, r.cardinality, r.is_directed,
      r.workspace_types, r.sort_order,
      0 AS priority
    FROM relation_type_registry r
    WHERE r.org_id IS NULL AND r.is_active = true

    UNION ALL

    SELECT
      r.relation_type, r.display_name, r.from_entity_type, r.to_entity_type,
      r.description, r.cardinality, r.is_directed,
      r.workspace_types, r.sort_order,
      1 AS priority
    FROM relation_type_registry r
    WHERE r.org_id = p_org_id AND r.is_active = true
  ),
  deduped AS (
    SELECT DISTINCT ON (relation_type, from_entity_type, to_entity_type)
      relation_type, display_name, from_entity_type, to_entity_type,
      description, cardinality, is_directed,
      workspace_types, sort_order
    FROM merged
    ORDER BY relation_type, from_entity_type, to_entity_type, priority DESC
  )
  SELECT
    d.relation_type, d.display_name, d.from_entity_type, d.to_entity_type,
    d.description, d.cardinality, d.is_directed,
    d.workspace_types, d.sort_order
  FROM deduped d
  WHERE
    (p_workspace_type IS NULL OR p_workspace_type = ANY(d.workspace_types))
  ORDER BY d.sort_order;
$$;

-- ============================================================
-- 7. SOURCE TABLE → UNIFIED TYPE MAPPING FUNCTION
-- ============================================================

/**
 * Maps a source table name to its unified entity type.
 * Used by graph-sync to translate table names to unified types.
 * e.g., 'ecom_customers' → 'person', 'crm_deals' → 'pipeline_item'
 */
CREATE OR REPLACE FUNCTION resolve_entity_type(
  p_source_table TEXT
)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT e.entity_type
  FROM entity_type_registry e
  WHERE e.org_id IS NULL
    AND p_source_table = ANY(e.source_tables)
    AND e.is_active = true
  LIMIT 1;
$$;
