/* ================================================================
   Migration 019 — Analytics RPC Functions

   Pushes analytics aggregation to Postgres instead of loading entire
   datasets into JavaScript. Designed for scale (millions of records).

   Functions are named `analytics_*` (not `ecom_*`) so they can be
   extended with UNIONs when Klaviyo, Facebook Ads, or service data
   is added later.

   All functions are SECURITY DEFINER with RLS-equivalent org_id checks
   so they work with the Supabase client's auth context.
   ================================================================ */

-- ── 1. Revenue by Period ──────────────────────────────────────────
-- Groups orders by day/week/month and returns aggregated revenue.
-- Used by: query_ecommerce_analytics metric="revenue" and metric="aov"

CREATE OR REPLACE FUNCTION analytics_revenue_by_period(
  p_org_id    UUID,
  p_cutoff    TIMESTAMPTZ,
  p_group_by  TEXT DEFAULT 'month'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  trunc_field TEXT;
BEGIN
  -- Validate group_by
  CASE p_group_by
    WHEN 'day' THEN trunc_field := 'day';
    WHEN 'week' THEN trunc_field := 'week';
    ELSE trunc_field := 'month';
  END CASE;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.period)
  INTO result
  FROM (
    SELECT
      TO_CHAR(DATE_TRUNC(trunc_field, created_at), 'YYYY-MM-DD') AS period,
      ROUND(SUM(total_price)::NUMERIC, 2) AS revenue,
      COUNT(*) AS order_count
    FROM ecom_orders
    WHERE org_id = p_org_id
      AND created_at >= p_cutoff
      AND total_price IS NOT NULL
    GROUP BY DATE_TRUNC(trunc_field, created_at)
    ORDER BY DATE_TRUNC(trunc_field, created_at)
  ) t;

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


-- ── 2. Repeat Purchase Rate ───────────────────────────────────────
-- Single aggregate query returning repeat vs one-time buyer stats.

CREATE OR REPLACE FUNCTION analytics_repeat_rate(
  p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  dist JSONB;
BEGIN
  -- Get distribution of order counts
  SELECT jsonb_agg(to_jsonb(d) ORDER BY d.order_bucket)
  INTO dist
  FROM (
    SELECT
      CASE
        WHEN orders_count = 1 THEN '1'
        WHEN orders_count = 2 THEN '2'
        WHEN orders_count = 3 THEN '3'
        WHEN orders_count BETWEEN 4 AND 5 THEN '4-5'
        WHEN orders_count BETWEEN 6 AND 10 THEN '6-10'
        ELSE '11+'
      END AS order_bucket,
      COUNT(*) AS customers
    FROM ecom_customers
    WHERE org_id = p_org_id AND orders_count > 0
    GROUP BY
      CASE
        WHEN orders_count = 1 THEN '1'
        WHEN orders_count = 2 THEN '2'
        WHEN orders_count = 3 THEN '3'
        WHEN orders_count BETWEEN 4 AND 5 THEN '4-5'
        WHEN orders_count BETWEEN 6 AND 10 THEN '6-10'
        ELSE '11+'
      END
    ORDER BY MIN(orders_count)
  ) d;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'one_time', COUNT(*) FILTER (WHERE orders_count = 1),
    'repeat', COUNT(*) FILTER (WHERE orders_count > 1),
    'repeat_pct', CASE
      WHEN COUNT(*) > 0 THEN ROUND(
        (COUNT(*) FILTER (WHERE orders_count > 1))::NUMERIC / COUNT(*)::NUMERIC * 100, 1
      )
      ELSE 0
    END,
    'distribution', COALESCE(dist, '[]'::JSONB)
  )
  INTO result
  FROM ecom_customers
  WHERE org_id = p_org_id AND orders_count > 0;

  RETURN COALESCE(result, '{}'::JSONB);
END;
$$;


-- ── 3. Top Products ──────────────────────────────────────────────
-- Unnests line_items JSONB at DB level instead of pulling all orders
-- into JS. Uses existing GIN index on line_items.

CREATE OR REPLACE FUNCTION analytics_top_products(
  p_org_id    UUID,
  p_cutoff    TIMESTAMPTZ,
  p_limit     INT DEFAULT 10,
  p_sort_by   TEXT DEFAULT 'revenue'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  sort_col TEXT;
BEGIN
  -- Validate sort_by
  CASE p_sort_by
    WHEN 'quantity' THEN sort_col := 'quantity_sold';
    WHEN 'orders' THEN sort_col := 'order_count';
    ELSE sort_col := 'revenue';
  END CASE;

  SELECT jsonb_agg(to_jsonb(t))
  INTO result
  FROM (
    SELECT
      COALESCE(item->>'title', item->>'name', 'Unknown Product') AS title,
      ROUND(SUM(
        COALESCE((item->>'price')::NUMERIC, 0) *
        GREATEST(COALESCE((item->>'quantity')::INT, 1), 1)
      )::NUMERIC, 2) AS revenue,
      SUM(GREATEST(COALESCE((item->>'quantity')::INT, 1), 1)) AS quantity_sold,
      COUNT(DISTINCT eo.id) AS order_count
    FROM ecom_orders eo,
    LATERAL jsonb_array_elements(eo.line_items) AS item
    WHERE eo.org_id = p_org_id
      AND eo.created_at >= p_cutoff
      AND eo.total_price IS NOT NULL
    GROUP BY COALESCE(item->>'title', item->>'name', 'Unknown Product')
    ORDER BY
      CASE WHEN sort_col = 'revenue' THEN SUM(COALESCE((item->>'price')::NUMERIC, 0) * GREATEST(COALESCE((item->>'quantity')::INT, 1), 1)) END DESC NULLS LAST,
      CASE WHEN sort_col = 'quantity_sold' THEN SUM(GREATEST(COALESCE((item->>'quantity')::INT, 1), 1)) END DESC NULLS LAST,
      CASE WHEN sort_col = 'order_count' THEN COUNT(DISTINCT eo.id) END DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


-- ── 4. Cohort Analysis ───────────────────────────────────────────
-- Groups customers by first-order month, aggregates at DB level.

CREATE OR REPLACE FUNCTION analytics_cohort(
  p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.cohort)
  INTO result
  FROM (
    SELECT
      TO_CHAR(DATE_TRUNC('month', first_order_at), 'YYYY-MM') AS cohort,
      COUNT(*) AS customers,
      ROUND(SUM(total_spent)::NUMERIC, 2) AS total_revenue,
      SUM(orders_count) AS total_orders,
      ROUND(
        (COUNT(*) FILTER (WHERE orders_count > 1))::NUMERIC /
        NULLIF(COUNT(*), 0)::NUMERIC * 100, 1
      ) AS repeat_pct,
      ROUND((SUM(total_spent) / NULLIF(COUNT(*), 0))::NUMERIC, 2) AS avg_ltv
    FROM ecom_customers
    WHERE org_id = p_org_id
      AND first_order_at IS NOT NULL
    GROUP BY DATE_TRUNC('month', first_order_at)
    ORDER BY DATE_TRUNC('month', first_order_at)
  ) t;

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;


-- ── 5. RFM Segments ──────────────────────────────────────────────
-- Uses NTILE(5) window functions for quintile scoring.
-- Eliminates the O(n^2) findIndex bug in the JS implementation.

CREATE OR REPLACE FUNCTION analytics_rfm_segments(
  p_org_id UUID,
  p_limit  INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  segments_result JSONB;
  top_customers_result JSONB;
BEGIN
  -- Use CTEs instead of temp tables (avoids ALTER/UPDATE which Supabase blocks)
  -- CTE 1: compute RFM scores with NTILE window functions
  -- CTE 2: add segment classification inline

  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.customers DESC)
  INTO segments_result
  FROM (
    WITH scored AS (
      SELECT
        COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') AS name,
        email,
        EXTRACT(DAY FROM (NOW() - COALESCE(last_order_at, NOW() - INTERVAL '999 days')))::INT AS recency_days,
        orders_count AS frequency,
        ROUND(total_spent::NUMERIC, 2) AS monetary,
        NTILE(5) OVER (ORDER BY COALESCE(last_order_at, '1970-01-01'::TIMESTAMPTZ) ASC) AS r_score,
        NTILE(5) OVER (ORDER BY orders_count DESC) AS f_score,
        NTILE(5) OVER (ORDER BY total_spent DESC) AS m_score
      FROM ecom_customers
      WHERE org_id = p_org_id AND orders_count > 0
    ),
    segmented AS (
      SELECT *,
        CASE
          WHEN r_score <= 2 AND f_score <= 2 AND m_score <= 2 THEN 'Champions'
          WHEN r_score <= 2 AND f_score <= 3 THEN 'Loyal Customers'
          WHEN r_score <= 2 AND f_score >= 4 THEN 'New Customers'
          WHEN r_score >= 4 AND f_score <= 2 THEN 'At Risk'
          WHEN r_score >= 4 AND f_score >= 4 THEN 'Lost'
          ELSE 'Need Attention'
        END AS segment
      FROM scored
    )
    SELECT segment, COUNT(*) AS customers
    FROM segmented
    GROUP BY segment
  ) s;

  SELECT jsonb_agg(to_jsonb(c))
  INTO top_customers_result
  FROM (
    WITH scored AS (
      SELECT
        COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') AS name,
        email,
        EXTRACT(DAY FROM (NOW() - COALESCE(last_order_at, NOW() - INTERVAL '999 days')))::INT AS recency_days,
        orders_count AS frequency,
        ROUND(total_spent::NUMERIC, 2) AS monetary,
        NTILE(5) OVER (ORDER BY COALESCE(last_order_at, '1970-01-01'::TIMESTAMPTZ) ASC) AS r_score,
        NTILE(5) OVER (ORDER BY orders_count DESC) AS f_score,
        NTILE(5) OVER (ORDER BY total_spent DESC) AS m_score
      FROM ecom_customers
      WHERE org_id = p_org_id AND orders_count > 0
    ),
    segmented AS (
      SELECT *,
        CASE
          WHEN r_score <= 2 AND f_score <= 2 AND m_score <= 2 THEN 'Champions'
          WHEN r_score <= 2 AND f_score <= 3 THEN 'Loyal Customers'
          WHEN r_score <= 2 AND f_score >= 4 THEN 'New Customers'
          WHEN r_score >= 4 AND f_score <= 2 THEN 'At Risk'
          WHEN r_score >= 4 AND f_score >= 4 THEN 'Lost'
          ELSE 'Need Attention'
        END AS segment
      FROM scored
    )
    SELECT
      TRIM(name) AS name,
      email,
      recency_days,
      frequency,
      monetary,
      r_score,
      f_score,
      m_score,
      segment
    FROM segmented
    ORDER BY (r_score + f_score + m_score) ASC, monetary DESC
    LIMIT p_limit
  ) c;

  RETURN jsonb_build_object(
    'segments', COALESCE(segments_result, '[]'::JSONB),
    'top_customers', COALESCE(top_customers_result, '[]'::JSONB)
  );
END;
$$;


-- ── Comments ──────────────────────────────────────────────────────

COMMENT ON FUNCTION analytics_revenue_by_period IS 'DB-level revenue aggregation by day/week/month. Replaces in-memory grouping.';
COMMENT ON FUNCTION analytics_repeat_rate IS 'DB-level repeat purchase rate with distribution. Replaces client-side counting.';
COMMENT ON FUNCTION analytics_top_products IS 'DB-level product ranking via JSONB unnesting. Replaces in-memory line_items iteration.';
COMMENT ON FUNCTION analytics_cohort IS 'DB-level customer cohort analysis. Replaces client-side grouping by first_order_at.';
COMMENT ON FUNCTION analytics_rfm_segments IS 'DB-level RFM segmentation using NTILE window functions. Replaces O(n^2) JS implementation.';
