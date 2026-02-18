-- ══════════════════════════════════════════════════════════════════════
-- Migration 014: Agentic Graph Foundation
-- Creates the knowledge web: graph_nodes, graph_edges, events
-- Plus graph_traverse() function for n-hop traversal
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Graph Nodes — Universal entity registry ─────────────────────

CREATE TABLE graph_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- What this node represents
  entity_type   TEXT NOT NULL,       -- 'crm_contacts', 'crm_companies', 'goals', 'concept', etc.
  entity_id     UUID,                -- FK to source table (NULL for abstract concepts)

  -- Denormalized display info (avoid JOINs for graph queries)
  label         TEXT NOT NULL,        -- "John Smith", "Acme Corp"
  sublabel      TEXT,                -- "VP Sales at Acme", "$50k proposal"

  -- Flexible properties for entities not in existing tables
  properties    JSONB NOT NULL DEFAULT '{}',

  -- Vector embedding for semantic graph search
  embedding     extensions.vector(1536),

  -- Lifecycle
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),

  -- Prevent duplicate nodes for the same source record
  UNIQUE(org_id, entity_type, entity_id)
);

-- Indexes
CREATE INDEX idx_graph_nodes_org ON graph_nodes(org_id);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(org_id, entity_type);
CREATE INDEX idx_graph_nodes_entity ON graph_nodes(entity_type, entity_id);
CREATE INDEX idx_graph_nodes_active ON graph_nodes(org_id) WHERE is_active = true;
CREATE INDEX idx_graph_nodes_label ON graph_nodes(org_id, label);
CREATE INDEX idx_graph_nodes_embedding ON graph_nodes
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- RLS
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view graph_nodes"
  ON graph_nodes FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert graph_nodes"
  ON graph_nodes FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update graph_nodes"
  ON graph_nodes FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete graph_nodes"
  ON graph_nodes FOR DELETE USING (user_has_org_role(org_id, 'admin'));


-- ── 2. Graph Edges — Typed, temporal relationships ─────────────────

CREATE TABLE graph_edges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Relationship endpoints
  source_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,

  -- Relationship semantics
  relation_type  TEXT NOT NULL,      -- 'works_at', 'owns_deal', 'blocks', 'depends_on', etc.

  -- Edge metadata
  weight         FLOAT NOT NULL DEFAULT 1.0,   -- Strength/confidence 0.0-1.0
  properties     JSONB NOT NULL DEFAULT '{}',

  -- Temporal validity (bitemporal)
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until    TIMESTAMPTZ,         -- NULL = currently valid

  -- Provenance
  source         TEXT NOT NULL DEFAULT 'system',  -- 'system', 'user', 'ai_extraction', 'import'
  confidence     FLOAT NOT NULL DEFAULT 1.0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),

  -- Prevent exact duplicate edges
  UNIQUE(org_id, source_node_id, target_node_id, relation_type, valid_from)
);

-- Indexes for graph traversal
CREATE INDEX idx_graph_edges_org ON graph_edges(org_id);
CREATE INDEX idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_type ON graph_edges(org_id, relation_type);
CREATE INDEX idx_graph_edges_active ON graph_edges(org_id) WHERE valid_until IS NULL;

-- RLS
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view graph_edges"
  ON graph_edges FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert graph_edges"
  ON graph_edges FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update graph_edges"
  ON graph_edges FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete graph_edges"
  ON graph_edges FOR DELETE USING (user_has_org_role(org_id, 'admin'));


-- ── 3. Events — Immutable action log ───────────────────────────────

CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- What happened
  event_type      TEXT NOT NULL,       -- 'data.created', 'ai.tool.called', etc.
  event_category  TEXT NOT NULL,       -- 'data', 'ai', 'auth', 'workflow', 'system'

  -- Who did it
  actor_type      TEXT NOT NULL,       -- 'user', 'ai', 'system', 'connector'
  actor_id        UUID,

  -- What was affected
  entity_type     TEXT,                -- 'crm_contacts', 'crm_deals', 'goals', etc.
  entity_id       UUID,

  -- Link to graph
  graph_node_id   UUID REFERENCES graph_nodes(id),

  -- Event payload
  payload         JSONB NOT NULL DEFAULT '{}',

  -- AI-specific
  session_id      UUID,
  tool_name       TEXT,
  parent_event_id UUID REFERENCES events(id),

  -- Extra metadata
  metadata        JSONB NOT NULL DEFAULT '{}',

  -- IMMUTABLE: no updated_at
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_events_org_time ON events(org_id, created_at DESC);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_events_type ON events(org_id, event_type, created_at DESC);
CREATE INDEX idx_events_actor ON events(org_id, actor_id, created_at DESC);
CREATE INDEX idx_events_session ON events(session_id, created_at DESC) WHERE session_id IS NOT NULL;
CREATE INDEX idx_events_category ON events(org_id, event_category, created_at DESC);
CREATE INDEX idx_events_parent ON events(parent_event_id) WHERE parent_event_id IS NOT NULL;

-- RLS: SELECT + INSERT only. Events are immutable — no UPDATE or DELETE.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view events"
  ON events FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org members insert events"
  ON events FOR INSERT WITH CHECK (user_is_org_member(org_id));


-- ── 4. Graph Traverse — N-hop recursive CTE function ───────────────

CREATE OR REPLACE FUNCTION graph_traverse(
  start_node_id UUID,
  max_depth INTEGER DEFAULT 3,
  relation_filter TEXT[] DEFAULT NULL,
  direction TEXT DEFAULT 'both'
)
RETURNS TABLE (
  node_id UUID,
  entity_type TEXT,
  entity_id UUID,
  label TEXT,
  sublabel TEXT,
  depth INTEGER,
  path UUID[],
  relation_types TEXT[]
)
LANGUAGE sql STABLE
AS $$
  WITH RECURSIVE traversal AS (
    -- Base case: start node
    SELECT
      n.id AS node_id,
      n.entity_type,
      n.entity_id,
      n.label,
      n.sublabel,
      0 AS depth,
      ARRAY[n.id] AS path,
      ARRAY[]::TEXT[] AS relation_types
    FROM graph_nodes n
    WHERE n.id = start_node_id
      AND n.is_active = true

    UNION ALL

    -- Recursive step: follow active edges
    SELECT
      next_node.id,
      next_node.entity_type,
      next_node.entity_id,
      next_node.label,
      next_node.sublabel,
      t.depth + 1,
      t.path || next_node.id,
      t.relation_types || e.relation_type
    FROM traversal t
    JOIN graph_edges e ON (
      (direction IN ('outgoing', 'both') AND e.source_node_id = t.node_id)
      OR
      (direction IN ('incoming', 'both') AND e.target_node_id = t.node_id)
    )
    JOIN graph_nodes next_node ON (
      CASE
        WHEN e.source_node_id = t.node_id THEN next_node.id = e.target_node_id
        ELSE next_node.id = e.source_node_id
      END
    )
    WHERE t.depth < max_depth
      AND NOT (next_node.id = ANY(t.path))    -- prevent cycles
      AND next_node.is_active = true
      AND e.valid_until IS NULL                -- only current edges
      AND (relation_filter IS NULL OR e.relation_type = ANY(relation_filter))
  )
  SELECT * FROM traversal ORDER BY depth, label;
$$;


-- ── 5. Batch populate graph from existing data ─────────────────────
-- This section creates graph nodes for all existing records and edges
-- for all existing foreign key relationships.

-- Helper function to populate nodes for a given org
-- (Run this after migration, per-org)

-- Contacts → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'crm_contacts',
  id,
  COALESCE(first_name || ' ' || last_name, email),
  COALESCE(title, status),
  user_id
FROM crm_contacts
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Companies → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'crm_companies',
  id,
  name,
  COALESCE(industry, domain),
  user_id
FROM crm_companies
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Deals → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'crm_deals',
  id,
  title,
  stage || COALESCE(' — $' || value::TEXT, ''),
  user_id
FROM crm_deals
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Activities → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'crm_activities',
  id,
  COALESCE(subject, type),
  type,
  user_id
FROM crm_activities
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Goals → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'goals',
  id,
  name,
  status,
  user_id
FROM goals
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Sub-goals → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel)
SELECT
  g.org_id,
  'sub_goals',
  sg.id,
  sg.name,
  sg.status
FROM sub_goals sg
JOIN goals g ON g.id = sg.goal_id
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Pain points → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'pain_points',
  id,
  name,
  severity || ' — ' || status,
  user_id
FROM pain_points
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Teams → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'teams',
  id,
  name,
  description,
  user_id
FROM teams
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Projects → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'projects',
  id,
  name,
  active_mode,
  user_id
FROM projects
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;

-- Library items → nodes
INSERT INTO graph_nodes (org_id, entity_type, entity_id, label, sublabel, created_by)
SELECT
  org_id,
  'library_items',
  id,
  title,
  category,
  user_id
FROM library_items
ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING;


-- ── 6. Batch populate edges from foreign keys ──────────────────────

-- Contact → Company (works_at)
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  cn.org_id,
  cn.id,
  co.id,
  'works_at'
FROM graph_nodes cn
JOIN crm_contacts c ON c.id = cn.entity_id AND cn.entity_type = 'crm_contacts'
JOIN graph_nodes co ON co.entity_id = c.company_id AND co.entity_type = 'crm_companies' AND co.org_id = cn.org_id
WHERE c.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Deal → Contact (primary_contact)
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  dn.org_id,
  dn.id,
  cn.id,
  'primary_contact'
FROM graph_nodes dn
JOIN crm_deals d ON d.id = dn.entity_id AND dn.entity_type = 'crm_deals'
JOIN graph_nodes cn ON cn.entity_id = d.contact_id AND cn.entity_type = 'crm_contacts' AND cn.org_id = dn.org_id
WHERE d.contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Deal → Company (for_company)
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  dn.org_id,
  dn.id,
  co.id,
  'for_company'
FROM graph_nodes dn
JOIN crm_deals d ON d.id = dn.entity_id AND dn.entity_type = 'crm_deals'
JOIN graph_nodes co ON co.entity_id = d.company_id AND co.entity_type = 'crm_companies' AND co.org_id = dn.org_id
WHERE d.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Activity → Contact
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  an.org_id,
  an.id,
  cn.id,
  'regarding_contact'
FROM graph_nodes an
JOIN crm_activities a ON a.id = an.entity_id AND an.entity_type = 'crm_activities'
JOIN graph_nodes cn ON cn.entity_id = a.contact_id AND cn.entity_type = 'crm_contacts' AND cn.org_id = an.org_id
WHERE a.contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Activity → Company
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  an.org_id,
  an.id,
  co.id,
  'regarding_company'
FROM graph_nodes an
JOIN crm_activities a ON a.id = an.entity_id AND an.entity_type = 'crm_activities'
JOIN graph_nodes co ON co.entity_id = a.company_id AND co.entity_type = 'crm_companies' AND co.org_id = an.org_id
WHERE a.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Activity → Deal
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  an.org_id,
  an.id,
  dn.id,
  'regarding_deal'
FROM graph_nodes an
JOIN crm_activities a ON a.id = an.entity_id AND an.entity_type = 'crm_activities'
JOIN graph_nodes dn ON dn.entity_id = a.deal_id AND dn.entity_type = 'crm_deals' AND dn.org_id = an.org_id
WHERE a.deal_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Sub-goal → Goal (child_of)
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  sgn.org_id,
  sgn.id,
  gn.id,
  'child_of'
FROM graph_nodes sgn
JOIN sub_goals sg ON sg.id = sgn.entity_id AND sgn.entity_type = 'sub_goals'
JOIN goals g ON g.id = sg.goal_id
JOIN graph_nodes gn ON gn.entity_id = g.id AND gn.entity_type = 'goals' AND gn.org_id = sgn.org_id
ON CONFLICT DO NOTHING;

-- Pain point → Goal (linked_to)
INSERT INTO graph_edges (org_id, source_node_id, target_node_id, relation_type)
SELECT
  ppn.org_id,
  ppn.id,
  gn.id,
  'linked_to'
FROM graph_nodes ppn
JOIN pain_points pp ON pp.id = ppn.entity_id AND ppn.entity_type = 'pain_points'
JOIN graph_nodes gn ON gn.entity_id = pp.linked_goal_id AND gn.entity_type = 'goals' AND gn.org_id = ppn.org_id
WHERE pp.linked_goal_id IS NOT NULL
ON CONFLICT DO NOTHING;
