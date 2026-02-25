-- =====================================================
-- Migration 030: Data Agent Infrastructure
--
-- Creates:
-- 1. get_platform_schema() — introspects all public tables/columns
-- 2. get_table_relationships() — discovers FK relationships
-- 3. exec_safe_sql() — executes SELECT queries with safety guards
-- 4. query_history table — stores past queries for self-learning
-- =====================================================

-- ─────────────────────────────────────────────
-- 1. RPC: get_platform_schema()
-- Returns all columns for all public tables, excluding system tables
-- SECURITY DEFINER — schema is org-agnostic
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_platform_schema()
RETURNS TABLE (
  table_name TEXT,
  column_name TEXT,
  data_type TEXT,
  is_nullable TEXT,
  column_default TEXT,
  ordinal_position INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    c.table_name::TEXT,
    c.column_name::TEXT,
    c.data_type::TEXT,
    c.is_nullable::TEXT,
    c.column_default::TEXT,
    c.ordinal_position::INTEGER
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    -- Exclude infrastructure/system tables
    AND c.table_name NOT IN (
      'schema_migrations',
      'spatial_ref_sys'
    )
    -- Exclude Supabase internal tables
    AND c.table_name NOT LIKE 'pg_%'
    AND c.table_name NOT LIKE '_realtime_%'
  ORDER BY c.table_name, c.ordinal_position;
$$;

-- ─────────────────────────────────────────────
-- 2. RPC: get_table_relationships()
-- Discovers all FK relationships between public tables
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_table_relationships()
RETURNS TABLE (
  source_table TEXT,
  source_column TEXT,
  target_table TEXT,
  target_column TEXT,
  constraint_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tc.table_name::TEXT AS source_table,
    kcu.column_name::TEXT AS source_column,
    ccu.table_name::TEXT AS target_table,
    ccu.column_name::TEXT AS target_column,
    tc.constraint_name::TEXT
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
  ORDER BY tc.table_name, kcu.column_name;
$$;

-- ─────────────────────────────────────────────
-- 3. RPC: exec_safe_sql()
-- Executes a SELECT query with safety guards:
--   - Must be SELECT only
--   - Statement timeout enforced
--   - Row limit enforced (LIMIT 200 if no LIMIT present)
--   - Returns JSONB array of result rows
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exec_safe_sql(
  p_org_id UUID,
  p_sql TEXT,
  p_timeout_ms INTEGER DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sql TEXT;
  v_result JSONB;
  v_lower TEXT;
BEGIN
  -- Normalize
  v_sql := trim(p_sql);
  v_lower := lower(v_sql);

  -- Safety check 1: Must start with SELECT or WITH
  IF NOT (v_lower LIKE 'select%' OR v_lower LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed. Got: %', left(v_sql, 50);
  END IF;

  -- Safety check 2: No destructive keywords anywhere
  IF v_lower ~ '(^|\s)(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|copy)\s' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  -- Safety check 3: No multiple statements (semicolons in the body)
  -- Allow trailing semicolon but not embedded ones
  IF position(';' IN trim(trailing ';' FROM v_sql)) > 0 THEN
    RAISE EXCEPTION 'Multiple statements are not allowed';
  END IF;

  -- Inject LIMIT if not present
  IF v_lower NOT LIKE '%limit%' THEN
    -- Remove trailing semicolon if present
    v_sql := trim(trailing ';' FROM v_sql);
    v_sql := v_sql || ' LIMIT 200';
  END IF;

  -- Set statement timeout
  EXECUTE format('SET LOCAL statement_timeout = %L', p_timeout_ms || 'ms');

  -- Execute and collect results as JSONB array
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t',
    v_sql
  )
  USING p_org_id
  INTO v_result;

  RETURN v_result;

EXCEPTION
  WHEN query_canceled THEN
    RAISE EXCEPTION 'Query timed out after %ms', p_timeout_ms;
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- ─────────────────────────────────────────────
-- 4. Table: query_history
-- Stores past queries for self-learning (few-shot retrieval)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  session_id TEXT,
  question TEXT NOT NULL,
  sql TEXT NOT NULL,
  tables_used TEXT[] NOT NULL DEFAULT '{}',
  domain TEXT,
  execution_time_ms INTEGER,
  row_count INTEGER,
  error TEXT,
  embedding vector(1536),
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_query_history_org_created
  ON query_history(org_id, created_at DESC);

-- HNSW vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_query_history_embedding
  ON query_history USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─────────────────────────────────────────────
-- 5. RLS for query_history
-- ─────────────────────────────────────────────

ALTER TABLE query_history ENABLE ROW LEVEL SECURITY;

-- Org members can read their org's query history
CREATE POLICY "query_history_select"
  ON query_history FOR SELECT
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Org members can insert query history for their org
CREATE POLICY "query_history_insert"
  ON query_history FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Service role can do everything (used by API routes)
CREATE POLICY "query_history_service"
  ON query_history FOR ALL
  USING (auth.role() = 'service_role');
