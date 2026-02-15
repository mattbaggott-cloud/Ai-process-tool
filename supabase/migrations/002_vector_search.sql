-- ============================================================
-- VECTOR SEARCH & RAG MIGRATION
-- Tables: document_chunks (pgvector), llm_logs
-- Function: hybrid_search
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENABLE PGVECTOR EXTENSION
-- ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


-- ────────────────────────────────────────────────────────────
-- 2. DOCUMENT CHUNKS TABLE
-- Stores chunked + embedded text from goals, pain points,
-- library items, files, etc. for semantic search
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source tracking
  source_table  TEXT NOT NULL,
  source_id     UUID NOT NULL,
  source_field  TEXT NOT NULL DEFAULT 'content',
  chunk_index   INTEGER NOT NULL DEFAULT 0,

  -- Chunk data
  chunk_text    TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}'::jsonb,

  -- Embedding (OpenAI text-embedding-3-small = 1536 dimensions)
  embedding     extensions.vector(1536),

  -- Timestamps
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  -- Prevent duplicate chunks for the same source
  UNIQUE(source_table, source_id, source_field, chunk_index)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON document_chunks(source_table, source_id);

-- HNSW index for vector similarity (works well with any dataset size)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Full-text search: generated tsvector column + GIN index
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING gin(fts);

-- RLS
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chunks"
  ON document_chunks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chunks"
  ON document_chunks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chunks"
  ON document_chunks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chunks"
  ON document_chunks FOR DELETE
  USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 3. HYBRID SEARCH FUNCTION
-- Combines vector similarity + full-text keyword matching
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding extensions.vector(1536),
  query_text TEXT,
  match_user_id UUID,
  match_count INTEGER DEFAULT 10,
  vector_weight FLOAT DEFAULT 0.7,
  text_weight FLOAT DEFAULT 0.3,
  source_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_table TEXT,
  source_id UUID,
  source_field TEXT,
  chunk_index INTEGER,
  chunk_text TEXT,
  metadata JSONB,
  similarity FLOAT,
  text_rank FLOAT,
  combined_score FLOAT
)
LANGUAGE sql STABLE
AS $$
  WITH vector_results AS (
    SELECT
      dc.id,
      dc.source_table,
      dc.source_id,
      dc.source_field,
      dc.chunk_index,
      dc.chunk_text,
      dc.metadata,
      1 - (dc.embedding <=> query_embedding) AS similarity,
      0::float AS text_rank
    FROM document_chunks dc
    WHERE dc.user_id = match_user_id
      AND (source_filter IS NULL OR dc.source_table = ANY(source_filter))
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  text_results AS (
    SELECT
      dc.id,
      dc.source_table,
      dc.source_id,
      dc.source_field,
      dc.chunk_index,
      dc.chunk_text,
      dc.metadata,
      0::float AS similarity,
      ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) AS text_rank
    FROM document_chunks dc
    WHERE dc.user_id = match_user_id
      AND dc.fts @@ websearch_to_tsquery('english', query_text)
      AND (source_filter IS NULL OR dc.source_table = ANY(source_filter))
    ORDER BY text_rank DESC
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) AS id,
      COALESCE(v.source_table, t.source_table) AS source_table,
      COALESCE(v.source_id, t.source_id) AS source_id,
      COALESCE(v.source_field, t.source_field) AS source_field,
      COALESCE(v.chunk_index, t.chunk_index) AS chunk_index,
      COALESCE(v.chunk_text, t.chunk_text) AS chunk_text,
      COALESCE(v.metadata, t.metadata) AS metadata,
      COALESCE(v.similarity, 0) AS similarity,
      COALESCE(t.text_rank, 0) AS text_rank,
      (COALESCE(v.similarity, 0) * vector_weight + COALESCE(t.text_rank, 0) * text_weight) AS combined_score
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT * FROM combined
  ORDER BY combined_score DESC
  LIMIT match_count;
$$;


-- ────────────────────────────────────────────────────────────
-- 4. LLM LOGS TABLE
-- Track every AI call: tokens, cost, latency, context
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_logs (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Request info
  model               TEXT NOT NULL,
  system_prompt_tokens INTEGER,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  total_tokens        INTEGER,

  -- Cost tracking (USD)
  input_cost          NUMERIC(10, 6),
  output_cost         NUMERIC(10, 6),
  total_cost          NUMERIC(10, 6),

  -- Performance
  latency_ms          INTEGER,

  -- RAG context
  retrieved_chunk_ids UUID[] DEFAULT '{}',
  retrieved_count     INTEGER DEFAULT 0,

  -- Tool use
  tool_calls          JSONB DEFAULT '[]'::jsonb,
  tool_rounds         INTEGER DEFAULT 0,

  -- Meta
  user_message        TEXT,
  stop_reason         TEXT,
  error               TEXT,

  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_logs_user ON llm_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_logs_created ON llm_logs(created_at DESC);

ALTER TABLE llm_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own logs"
  ON llm_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own logs"
  ON llm_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- DONE! Run this in your Supabase SQL Editor.
-- Then run: node scripts/reembed-all.mjs
-- ============================================================
