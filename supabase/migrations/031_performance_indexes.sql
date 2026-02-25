-- =====================================================
-- Migration 031: Performance Indexes for Data Agent
--
-- Adds indexes for common query patterns that the Data Agent
-- generates. These are the most frequent ORDER BY, WHERE, and
-- JOIN patterns based on the types of questions users ask.
--
-- All indexes use IF NOT EXISTS — safe to re-run.
-- =====================================================

-- ── E-Commerce Customers ─────────────────────────────
-- Existing (017): org, email, external, total_spent DESC, last_order_at DESC, tags GIN

-- "top customers by order count", "repeat buyers", "first-time buyers (orders_count = 1)"
CREATE INDEX IF NOT EXISTS idx_ecom_customers_orders_count
  ON ecom_customers(org_id, orders_count DESC);

-- "new customers this month", "customers who signed up in Q4"
CREATE INDEX IF NOT EXISTS idx_ecom_customers_created
  ON ecom_customers(org_id, created_at DESC);

-- "customers with highest AOV"
CREATE INDEX IF NOT EXISTS idx_ecom_customers_aov
  ON ecom_customers(org_id, avg_order_value DESC);

-- "first-time buyers" — partial index for orders_count = 1 (very common question)
CREATE INDEX IF NOT EXISTS idx_ecom_customers_first_time
  ON ecom_customers(org_id, created_at DESC) WHERE orders_count = 1;

-- "customers who accept marketing", "marketable customers"
CREATE INDEX IF NOT EXISTS idx_ecom_customers_marketing
  ON ecom_customers(org_id, accepts_marketing) WHERE accepts_marketing = true;

-- ── E-Commerce Orders ────────────────────────────────
-- Existing (017): org, customer, external, email, processed_at DESC, financial_status, tags GIN, line_items GIN

-- "highest value orders", "orders over $100", "top orders by revenue"
CREATE INDEX IF NOT EXISTS idx_ecom_orders_total_price
  ON ecom_orders(org_id, total_price DESC);

-- "recent orders", "orders this week"
CREATE INDEX IF NOT EXISTS idx_ecom_orders_created
  ON ecom_orders(org_id, created_at DESC);

-- "unfulfilled orders", "orders pending fulfillment"
CREATE INDEX IF NOT EXISTS idx_ecom_orders_fulfillment
  ON ecom_orders(org_id, fulfillment_status);

-- "orders from web vs POS", "order sources"
CREATE INDEX IF NOT EXISTS idx_ecom_orders_source
  ON ecom_orders(org_id, source_name);

-- ── E-Commerce Products ──────────────────────────────
-- Existing (017): org, external, status, tags GIN, type

-- "products by vendor", "Nike products"
CREATE INDEX IF NOT EXISTS idx_ecom_products_vendor
  ON ecom_products(org_id, vendor);

-- "recently added products"
CREATE INDEX IF NOT EXISTS idx_ecom_products_created
  ON ecom_products(org_id, created_at DESC);

-- ── CRM Contacts ─────────────────────────────────────
-- Existing (003/011): user, company, status, email, org

-- "recent contacts", "contacts added this month"
CREATE INDEX IF NOT EXISTS idx_crm_contacts_created
  ON crm_contacts(org_id, created_at DESC);

-- ── CRM Deals ────────────────────────────────────────
-- Existing (003/011): user, stage, contact, company, org

-- "deals by value", "biggest deals", "pipeline value"
CREATE INDEX IF NOT EXISTS idx_crm_deals_value
  ON crm_deals(org_id, value DESC);

-- "recent deals", "deals created this quarter"
CREATE INDEX IF NOT EXISTS idx_crm_deals_created
  ON crm_deals(org_id, created_at DESC);

-- "deals closing this month"
CREATE INDEX IF NOT EXISTS idx_crm_deals_close_date
  ON crm_deals(org_id, expected_close_date DESC);

-- ── Email Campaigns ──────────────────────────────────
-- Existing (026): org, status, segment, send_at, campaign+variant

-- "recent campaigns", "campaigns this month"
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created
  ON email_campaigns(org_id, created_at DESC);

-- ── Segments ─────────────────────────────────────────
-- Existing (020): org, status, parent, path GIN, type

-- "largest segments", "segment sizes"
CREATE INDEX IF NOT EXISTS idx_segments_customer_count
  ON segments(org_id, customer_count DESC);

-- ── Query History (Data Agent self-learning) ─────────
-- Existing (030): org+created, embedding vector

-- "queries that succeeded" — for few-shot example retrieval
-- query_history uses error IS NULL + verified = true to indicate success
CREATE INDEX IF NOT EXISTS idx_query_history_verified
  ON query_history(org_id, verified, created_at DESC) WHERE error IS NULL;

-- ── Graph Nodes (Schema lookups) ─────────────────────
-- Existing (014): org, type, entity, active, label, embedding

-- Data Agent schema lookups: "find all data_table nodes for this org"
CREATE INDEX IF NOT EXISTS idx_graph_nodes_entity_type_active
  ON graph_nodes(org_id, entity_type, is_active) WHERE entity_type IN ('data_table', 'data_column');

-- ── Document Chunks (Vector search filtering) ────────
-- Existing (002): user_id, source_table+source_id, embedding, FTS

-- Data Agent schema chunks: filter by source_table = 'schema'
CREATE INDEX IF NOT EXISTS idx_document_chunks_source_table
  ON document_chunks(source_table) WHERE source_table = 'schema';


-- =====================================================
-- org_id Security Hardening for exec_safe_sql
--
-- The original exec_safe_sql (migration 030) accepts p_org_id
-- but doesn't enforce that the SQL actually filters on it.
-- Since exec_safe_sql is SECURITY DEFINER (bypasses RLS),
-- a missing org_id filter means cross-tenant data leakage.
--
-- This update adds a mandatory check: the SQL must contain
-- the literal org_id UUID string. If it doesn't, the query
-- is rejected before execution.
-- =====================================================

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
  v_org_id_str TEXT;
BEGIN
  -- Normalize
  v_sql := trim(p_sql);
  v_lower := lower(v_sql);
  v_org_id_str := p_org_id::TEXT;

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

  -- Safety check 4 (NEW): SQL must contain the literal org_id UUID
  -- This prevents cross-tenant data leakage. The Generator always
  -- injects org_id = '<uuid>' into WHERE clauses, so any legitimate
  -- query will contain the UUID string. Missing it means something
  -- went wrong in SQL generation.
  IF position(v_org_id_str IN v_sql) = 0 THEN
    RAISE EXCEPTION 'Query must filter by org_id. The literal org_id UUID (%) was not found in the SQL.', v_org_id_str;
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
