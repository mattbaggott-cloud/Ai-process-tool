-- ============================================================
-- Migration 034: Document Management
--
-- Enhances library_items and library_files for Phase 6:
-- - is_archived soft-delete on both tables
-- - source_type tracking (ai/manual/import/upload)
-- - Missing columns on library_files (category, tags)
-- - New relation types for document → entity graph edges
-- ============================================================

-- 1. library_items enhancements
ALTER TABLE library_items ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE library_items ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'ai';

-- 2. library_files enhancements
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Document';
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'upload';
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- 3. Partial indexes for archive filtering (most queries filter is_archived = false)
CREATE INDEX IF NOT EXISTS idx_library_items_active
  ON library_items(org_id, is_archived) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_library_files_active
  ON library_files(org_id, is_archived) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_library_items_category
  ON library_items(org_id, category);
CREATE INDEX IF NOT EXISTS idx_library_files_category
  ON library_files(org_id, category);

-- 4. New relation types for document → entity edges
INSERT INTO relation_type_registry (org_id, relation_type, display_name, from_entity_type, to_entity_type, description, cardinality, is_directed, workspace_types, sort_order)
VALUES
  (NULL, 'documents', 'documents', 'document', 'company',
   'Document is about or related to this company.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 230),

  (NULL, 'documents_person', 'documents', 'document', 'person',
   'Document is about or related to this person.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 240),

  (NULL, 'documents_deal', 'documents', 'document', 'pipeline_item',
   'Document is about or related to this deal/opportunity.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 250),

  (NULL, 'documents_product', 'documents', 'document', 'product',
   'Document is about or related to this product.',
   'many_to_many', true, '{b2b,b2c,hybrid}', 260)

ON CONFLICT (org_id, relation_type, from_entity_type, to_entity_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  updated_at = now();

-- 5. Auto-purge: hard-delete archived docs older than 30 days
-- Called on a schedule (pg_cron) or manually. Cleans up rows, chunks, and graph nodes.
CREATE OR REPLACE FUNCTION purge_archived_documents(p_retention_days INTEGER DEFAULT 30)
RETURNS TABLE (purged_items INTEGER, purged_files INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_items INTEGER := 0;
  v_files INTEGER := 0;
  v_cutoff TIMESTAMPTZ := now() - (p_retention_days || ' days')::INTERVAL;
BEGIN
  -- Clean up vector chunks for expired library_items
  DELETE FROM document_chunks
  WHERE source_table = 'library_items'
    AND source_id IN (
      SELECT id FROM library_items
      WHERE is_archived = true AND updated_at < v_cutoff
    );

  -- Clean up graph nodes for expired library_items
  DELETE FROM graph_nodes
  WHERE entity_type = 'document'
    AND entity_id IN (
      SELECT id::TEXT FROM library_items
      WHERE is_archived = true AND updated_at < v_cutoff
    );

  -- Hard-delete expired library_items
  DELETE FROM library_items
  WHERE is_archived = true AND updated_at < v_cutoff;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- Same for library_files
  DELETE FROM document_chunks
  WHERE source_table = 'library_files'
    AND source_id IN (
      SELECT id FROM library_files
      WHERE is_archived = true AND updated_at < v_cutoff
    );

  DELETE FROM graph_nodes
  WHERE entity_type = 'document'
    AND entity_id IN (
      SELECT id::TEXT FROM library_files
      WHERE is_archived = true AND updated_at < v_cutoff
    );

  DELETE FROM library_files
  WHERE is_archived = true AND updated_at < v_cutoff;
  GET DIAGNOSTICS v_files = ROW_COUNT;

  RETURN QUERY SELECT v_items, v_files;
END;
$$;
