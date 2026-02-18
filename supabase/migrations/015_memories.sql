-- ============================================================
-- Migration 015: Memory Layer for Agentic Graph
-- Persistent organizational memory that compounds over time.
-- Memories are superseded, never deleted.
-- ============================================================

-- ── Table: memories ─────────────────────────────────────────
-- Bitemporal: valid_at (when fact became true),
--             invalid_at (when it stopped being true),
--             created_at (when system recorded it).

CREATE TABLE IF NOT EXISTS memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Scope: who/what this memory applies to
  scope_type      TEXT NOT NULL,        -- 'org', 'team', 'user', 'project', 'entity'
  scope_id        UUID,                 -- team_id, user_id, project_id, graph_node_id (NULL for org-wide)

  -- Memory classification
  memory_type     TEXT NOT NULL,        -- 'fact', 'preference', 'procedure', 'insight',
                                        -- 'pattern', 'correction', 'relationship'
  content         TEXT NOT NULL,         -- Human-readable: "User prefers deal values in EUR"

  -- Structured triple (optional, for machine reasoning)
  subject         TEXT,                  -- "user:abc-123" or "org:xyz"
  predicate       TEXT,                  -- "prefers_currency", "typical_sales_cycle"
  object          TEXT,                  -- "EUR", "45 days"

  -- Temporal validity
  valid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalid_at      TIMESTAMPTZ,          -- NULL = currently valid

  -- Provenance
  source_type     TEXT NOT NULL,         -- 'ai_extraction', 'user_stated', 'system_observed'
  source_event_id UUID REFERENCES events(id),
  confidence      FLOAT NOT NULL DEFAULT 0.8,

  -- Embedding for semantic retrieval
  embedding       extensions.vector(1536),

  -- Importance & access tracking
  importance      FLOAT NOT NULL DEFAULT 0.5,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed   TIMESTAMPTZ,

  -- Lifecycle
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  superseded_by   UUID REFERENCES memories(id),

  -- Full-text search
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

-- ── Indexes ─────────────────────────────────────────────────

-- Primary lookup: active memories for an org
CREATE INDEX IF NOT EXISTS idx_memories_org_active
  ON memories (org_id, scope_type)
  WHERE invalid_at IS NULL AND superseded_by IS NULL;

-- Scope-based retrieval
CREATE INDEX IF NOT EXISTS idx_memories_scope
  ON memories (org_id, scope_type, scope_id)
  WHERE invalid_at IS NULL AND superseded_by IS NULL;

-- Memory type filtering
CREATE INDEX IF NOT EXISTS idx_memories_type
  ON memories (org_id, memory_type)
  WHERE invalid_at IS NULL AND superseded_by IS NULL;

-- HNSW vector index for semantic search
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 100);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_memories_fts
  ON memories USING gin (fts);

-- Importance ranking (for surfacing most useful memories)
CREATE INDEX IF NOT EXISTS idx_memories_importance
  ON memories (org_id, importance DESC)
  WHERE invalid_at IS NULL AND superseded_by IS NULL;

-- Confidence filtering (for admin review of low-confidence)
CREATE INDEX IF NOT EXISTS idx_memories_confidence
  ON memories (org_id, confidence)
  WHERE invalid_at IS NULL AND superseded_by IS NULL;

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- Org members can read memories for their org
CREATE POLICY memories_select ON memories
  FOR SELECT USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Org members can insert memories for their org
CREATE POLICY memories_insert ON memories
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Org members can update memories (for superseding, invalidating, access tracking)
CREATE POLICY memories_update ON memories
  FOR UPDATE USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- No DELETE policy — memories are superseded, never deleted

-- ── Function: retrieve_memories ─────────────────────────────
-- Hybrid retrieval: vector similarity + importance + recency

CREATE OR REPLACE FUNCTION retrieve_memories(
  p_org_id          UUID,
  p_query_embedding extensions.vector(1536),
  p_query_text      TEXT DEFAULT NULL,
  p_scope_types     TEXT[] DEFAULT ARRAY['org', 'user', 'team'],
  p_scope_id        UUID DEFAULT NULL,
  p_limit           INTEGER DEFAULT 10,
  p_min_confidence  FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  memory_id    UUID,
  content      TEXT,
  memory_type  TEXT,
  scope_type   TEXT,
  scope_id     UUID,
  confidence   FLOAT,
  importance   FLOAT,
  valid_at     TIMESTAMPTZ,
  source_type  TEXT,
  subject      TEXT,
  predicate    TEXT,
  object       TEXT,
  similarity   FLOAT,
  final_score  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      m.id,
      m.content,
      m.memory_type,
      m.scope_type,
      m.scope_id,
      m.confidence,
      m.importance,
      m.valid_at,
      m.source_type,
      m.subject,
      m.predicate,
      m.object,
      -- Vector similarity (cosine)
      CASE
        WHEN m.embedding IS NOT NULL
        THEN 1 - (m.embedding <=> p_query_embedding)
        ELSE 0
      END AS sim,
      -- Recency bonus (memories from last 7 days get a boost)
      CASE
        WHEN m.created_at > now() - interval '7 days' THEN 0.1
        WHEN m.created_at > now() - interval '30 days' THEN 0.05
        ELSE 0
      END AS recency_bonus
    FROM memories m
    WHERE m.org_id = p_org_id
      AND m.invalid_at IS NULL
      AND m.superseded_by IS NULL
      AND m.confidence >= p_min_confidence
      AND m.scope_type = ANY(p_scope_types)
      AND (p_scope_id IS NULL OR m.scope_id = p_scope_id OR m.scope_type = 'org')
  )
  SELECT
    s.id,
    s.content,
    s.memory_type,
    s.scope_type,
    s.scope_id,
    s.confidence,
    s.importance,
    s.valid_at,
    s.source_type,
    s.subject,
    s.predicate,
    s.object,
    s.sim,
    -- Final score: 50% similarity + 30% importance + 20% (confidence + recency)
    (s.sim * 0.5 + s.importance * 0.3 + (s.confidence * 0.1 + s.recency_bonus) * 2.0) AS score
  FROM scored s
  WHERE s.sim > 0.1 OR s.importance > 0.7  -- Include high-importance memories even with low similarity
  ORDER BY score DESC
  LIMIT p_limit;
END;
$$;

-- ── Function: bump_memory_access ────────────────────────────
-- Called when a memory is retrieved and used in a prompt

CREATE OR REPLACE FUNCTION bump_memory_access(memory_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE memories
  SET
    access_count = access_count + 1,
    last_accessed = now(),
    -- Boost importance slightly when accessed (capped at 1.0)
    importance = LEAST(importance + 0.02, 1.0)
  WHERE id = ANY(memory_ids);
END;
$$;
