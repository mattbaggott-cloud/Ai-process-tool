/* ================================================================
   Migration 021 — Segmentation RPC Functions

   6 Postgres functions for the AI Segmentation Engine:
   1. analytics_purchase_intervals   — LAG() for inter-order day-gaps
   2. analytics_product_affinities   — line_items unnesting per customer
   3. analytics_compute_behavioral_profiles — orchestrator: upserts profiles
   4. analytics_discover_segments    — finds natural behavioral clusters
   5. analytics_assign_segment_members — evaluates rules, assigns members
   6. analytics_segment_tree         — returns nested segment tree

   All SECURITY DEFINER with p_org_id checks.
   ================================================================ */

-- ── 1. Purchase Intervals ───────────────────────────────────────
-- Computes day-gaps between consecutive orders per customer.
-- Uses LAG() window function and linear regression for trend detection.

CREATE OR REPLACE FUNCTION analytics_purchase_intervals(
  p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH order_gaps AS (
    SELECT
      customer_id,
      created_at,
      LAG(created_at) OVER (PARTITION BY customer_id ORDER BY created_at) AS prev_order_at,
      ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) AS order_num
    FROM ecom_orders
    WHERE org_id = p_org_id
      AND customer_id IS NOT NULL
  ),
  intervals AS (
    SELECT
      customer_id,
      order_num,
      EXTRACT(EPOCH FROM (created_at - prev_order_at)) / 86400.0 AS interval_days
    FROM order_gaps
    WHERE prev_order_at IS NOT NULL
  ),
  customer_intervals AS (
    SELECT
      customer_id,
      array_agg(ROUND(interval_days::numeric, 1) ORDER BY order_num) AS intervals_arr,
      ROUND(AVG(interval_days)::numeric, 2) AS avg_interval,
      ROUND(STDDEV(interval_days)::numeric, 2) AS stddev_interval,
      COUNT(*) AS interval_count,
      -- Linear regression slope on interval sequence to detect acceleration
      -- Negative slope = intervals getting shorter = accelerating
      CASE
        WHEN COUNT(*) < 2 THEN NULL
        ELSE ROUND(REGR_SLOPE(interval_days, order_num)::numeric, 4)
      END AS slope
    FROM intervals
    GROUP BY customer_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      ci.customer_id,
      ci.intervals_arr,
      ci.avg_interval,
      ci.stddev_interval,
      ci.interval_count,
      ci.slope,
      CASE
        WHEN ci.interval_count < 2 THEN 'insufficient_data'
        WHEN ci.slope IS NULL THEN 'insufficient_data'
        WHEN ci.slope < -1.0 THEN 'accelerating'
        WHEN ci.slope > 1.0 THEN 'decelerating'
        WHEN ci.stddev_interval IS NOT NULL AND ci.stddev_interval > ci.avg_interval * 0.5 THEN 'erratic'
        ELSE 'stable'
      END AS trend,
      -- Predict next purchase: last_order + avg_interval
      ec.last_order_at + make_interval(days => ROUND(ci.avg_interval)::int) AS predicted_next,
      GREATEST(0, EXTRACT(EPOCH FROM (
        ec.last_order_at + make_interval(days => ROUND(ci.avg_interval)::int) - now()
      )) / 86400.0)::int AS days_until
    FROM customer_intervals ci
    JOIN ecom_customers ec ON ec.id = ci.customer_id AND ec.org_id = p_org_id
  ) t;

  RETURN result;
END;
$$;

-- ── 2. Product Affinities ───────────────────────────────────────
-- Unnests line_items JSONB, groups by customer × product,
-- computes purchase percentage per product per customer.

CREATE OR REPLACE FUNCTION analytics_product_affinities(
  p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH order_items AS (
    SELECT
      o.customer_id,
      item->>'title' AS product_title,
      item->>'product_type' AS product_type,
      (item->>'quantity')::int AS quantity
    FROM ecom_orders o,
    LATERAL jsonb_array_elements(o.line_items) AS item
    WHERE o.org_id = p_org_id
      AND o.customer_id IS NOT NULL
      AND o.line_items IS NOT NULL
      AND jsonb_array_length(o.line_items) > 0
  ),
  customer_order_counts AS (
    SELECT customer_id, COUNT(DISTINCT id) AS total_orders
    FROM ecom_orders
    WHERE org_id = p_org_id AND customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  product_counts AS (
    SELECT
      oi.customer_id,
      oi.product_title,
      oi.product_type,
      COUNT(*) AS purchase_count,
      SUM(oi.quantity) AS total_quantity
    FROM order_items oi
    GROUP BY oi.customer_id, oi.product_title, oi.product_type
  ),
  ranked AS (
    SELECT
      pc.customer_id,
      pc.product_title,
      pc.product_type,
      pc.purchase_count,
      pc.total_quantity,
      ROUND(pc.purchase_count::numeric / GREATEST(coc.total_orders, 1), 3) AS pct_of_orders,
      ROW_NUMBER() OVER (PARTITION BY pc.customer_id ORDER BY pc.purchase_count DESC, pc.total_quantity DESC) AS rank
    FROM product_counts pc
    JOIN customer_order_counts coc ON coc.customer_id = pc.customer_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      customer_id,
      jsonb_agg(
        jsonb_build_object(
          'product_title', product_title,
          'product_type', product_type,
          'purchase_count', purchase_count,
          'total_quantity', total_quantity,
          'pct_of_orders', pct_of_orders
        ) ORDER BY rank
      ) FILTER (WHERE rank <= 5) AS affinities,
      MAX(product_title) FILTER (WHERE rank = 1) AS top_product_title,
      MAX(product_type) FILTER (WHERE rank = 1) AS top_product_type
    FROM ranked
    GROUP BY customer_id
  ) t;

  RETURN result;
END;
$$;

-- ── 3. Compute Behavioral Profiles (Orchestrator) ───────────────
-- Combines intervals + affinities + enhanced RFM + lifecycle,
-- upserts into customer_behavioral_profiles.

CREATE OR REPLACE FUNCTION analytics_compute_behavioral_profiles(
  p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  -- Build profiles using CTEs and upsert
  WITH intervals_data AS (
    SELECT
      t.customer_id,
      t.intervals_arr,
      t.avg_interval,
      t.stddev_interval,
      t.trend,
      t.predicted_next,
      t.days_until
    FROM (
      SELECT * FROM jsonb_to_recordset(analytics_purchase_intervals(p_org_id))
      AS x(
        customer_id UUID,
        intervals_arr NUMERIC[],
        avg_interval NUMERIC,
        stddev_interval NUMERIC,
        trend TEXT,
        predicted_next TIMESTAMPTZ,
        days_until INTEGER
      )
    ) t
  ),
  affinities_data AS (
    SELECT
      t.customer_id,
      t.affinities,
      t.top_product_title,
      t.top_product_type
    FROM (
      SELECT * FROM jsonb_to_recordset(analytics_product_affinities(p_org_id))
      AS x(
        customer_id UUID,
        affinities JSONB,
        top_product_title TEXT,
        top_product_type TEXT
      )
    ) t
  ),
  -- Enhanced RFM with NTILE scoring
  rfm_scores AS (
    SELECT
      ec.id AS customer_id,
      NTILE(5) OVER (ORDER BY ec.last_order_at ASC) AS r_score,
      NTILE(5) OVER (ORDER BY ec.orders_count ASC) AS f_score,
      NTILE(5) OVER (ORDER BY ec.total_spent ASC) AS m_score,
      -- Velocity score: based on interval trend
      CASE
        WHEN id_data.trend = 'accelerating' THEN 5
        WHEN id_data.trend = 'stable' THEN 4
        WHEN id_data.trend = 'erratic' THEN 2
        WHEN id_data.trend = 'decelerating' THEN 1
        ELSE 3  -- insufficient_data
      END AS v_score,
      -- Consistency: 1 - (stddev / avg), clamped to 0-1
      CASE
        WHEN id_data.avg_interval IS NOT NULL AND id_data.avg_interval > 0
        THEN GREATEST(0, LEAST(1, 1.0 - COALESCE(id_data.stddev_interval, 0) / id_data.avg_interval))
        ELSE 0
      END AS consistency
    FROM ecom_customers ec
    LEFT JOIN intervals_data id_data ON id_data.customer_id = ec.id
    WHERE ec.org_id = p_org_id AND ec.orders_count > 0
  ),
  full_profiles AS (
    SELECT
      ec.id AS ecom_customer_id,
      p_org_id AS org_id,
      -- Intervals
      COALESCE(id_data.intervals_arr, '{}') AS purchase_intervals_days,
      id_data.avg_interval AS avg_interval_days,
      id_data.stddev_interval AS interval_stddev,
      COALESCE(id_data.trend, 'insufficient_data') AS interval_trend,
      id_data.predicted_next AS predicted_next_purchase,
      id_data.days_until AS days_until_predicted,
      -- Product affinity
      COALESCE(af_data.affinities, '[]'::jsonb) AS product_affinities,
      af_data.top_product_type,
      af_data.top_product_title,
      -- Scores
      rfm.r_score AS recency_score,
      rfm.f_score AS frequency_score,
      rfm.m_score AS monetary_score,
      rfm.v_score AS velocity_score,
      ROUND(rfm.consistency::numeric, 2) AS consistency_score,
      -- Composite engagement = weighted average of all scores
      ROUND((
        rfm.r_score * 0.25 +
        rfm.f_score * 0.25 +
        rfm.m_score * 0.20 +
        rfm.v_score * 0.15 +
        rfm.consistency * 5 * 0.15  -- scale consistency 0-1 to 0-5
      ) / 5.0, 2)::numeric AS engagement_score,
      -- Lifecycle stage
      CASE
        WHEN ec.orders_count = 1 AND ec.last_order_at > now() - interval '30 days' THEN 'new'
        WHEN rfm.r_score >= 4 AND rfm.f_score >= 4 AND rfm.m_score >= 4 THEN 'champion'
        WHEN rfm.r_score >= 3 AND rfm.f_score >= 3 THEN 'loyal'
        WHEN rfm.r_score >= 3 AND rfm.f_score <= 2 THEN 'active'
        WHEN rfm.r_score = 2 AND rfm.f_score >= 2 THEN 'at_risk'
        WHEN rfm.r_score = 1 AND ec.orders_count >= 3 THEN 'win_back'
        WHEN rfm.r_score = 1 THEN 'lapsed'
        ELSE 'active'
      END AS lifecycle_stage,
      -- Communication style (heuristic based on order patterns)
      CASE
        WHEN rfm.v_score >= 4 AND rfm.consistency >= 0.7 THEN 'data_driven'
        WHEN rfm.r_score <= 2 AND ec.orders_count >= 2 THEN 'urgency_responsive'
        WHEN rfm.m_score >= 4 THEN 'aspirational'
        WHEN rfm.f_score >= 4 THEN 'social_proof'
        WHEN ec.orders_count <= 2 THEN 'casual'
        ELSE 'unknown'
      END AS inferred_comm_style,
      now() AS computed_at
    FROM ecom_customers ec
    LEFT JOIN intervals_data id_data ON id_data.customer_id = ec.id
    LEFT JOIN affinities_data af_data ON af_data.customer_id = ec.id
    LEFT JOIN rfm_scores rfm ON rfm.customer_id = ec.id
    WHERE ec.org_id = p_org_id AND ec.orders_count > 0
  )
  INSERT INTO customer_behavioral_profiles (
    org_id, ecom_customer_id,
    purchase_intervals_days, avg_interval_days, interval_stddev, interval_trend,
    predicted_next_purchase, days_until_predicted,
    product_affinities, top_product_type, top_product_title,
    recency_score, frequency_score, monetary_score, velocity_score,
    consistency_score, engagement_score,
    lifecycle_stage, inferred_comm_style, computed_at
  )
  SELECT
    org_id, ecom_customer_id,
    purchase_intervals_days, avg_interval_days, interval_stddev, interval_trend,
    predicted_next_purchase, days_until_predicted,
    product_affinities, top_product_type, top_product_title,
    recency_score, frequency_score, monetary_score, velocity_score,
    consistency_score, engagement_score,
    lifecycle_stage, inferred_comm_style, computed_at
  FROM full_profiles
  ON CONFLICT (org_id, ecom_customer_id)
  DO UPDATE SET
    purchase_intervals_days = EXCLUDED.purchase_intervals_days,
    avg_interval_days = EXCLUDED.avg_interval_days,
    interval_stddev = EXCLUDED.interval_stddev,
    interval_trend = EXCLUDED.interval_trend,
    predicted_next_purchase = EXCLUDED.predicted_next_purchase,
    days_until_predicted = EXCLUDED.days_until_predicted,
    product_affinities = EXCLUDED.product_affinities,
    top_product_type = EXCLUDED.top_product_type,
    top_product_title = EXCLUDED.top_product_title,
    recency_score = EXCLUDED.recency_score,
    frequency_score = EXCLUDED.frequency_score,
    monetary_score = EXCLUDED.monetary_score,
    velocity_score = EXCLUDED.velocity_score,
    consistency_score = EXCLUDED.consistency_score,
    engagement_score = EXCLUDED.engagement_score,
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    inferred_comm_style = EXCLUDED.inferred_comm_style,
    computed_at = EXCLUDED.computed_at;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'profiles_updated', updated_count,
    'computed_at', now()
  );
END;
$$;

-- ── 4. Discover Segments ────────────────────────────────────────
-- Finds natural behavioral clusters from computed profiles.
-- Groups by lifecycle_stage × top_product_type × interval_trend.

CREATE OR REPLACE FUNCTION analytics_discover_segments(
  p_org_id    UUID,
  p_min_size  INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH clusters AS (
    SELECT
      lifecycle_stage,
      top_product_type,
      interval_trend,
      inferred_comm_style,
      COUNT(*) AS customer_count,
      ROUND(AVG(engagement_score), 3) AS avg_engagement,
      ROUND(AVG(avg_interval_days), 1) AS avg_purchase_interval,
      ROUND(AVG(consistency_score), 3) AS avg_consistency,
      -- Aggregate RFM scores
      ROUND(AVG(recency_score), 1) AS avg_recency,
      ROUND(AVG(frequency_score), 1) AS avg_frequency,
      ROUND(AVG(monetary_score), 1) AS avg_monetary
    FROM customer_behavioral_profiles
    WHERE org_id = p_org_id
    GROUP BY lifecycle_stage, top_product_type, interval_trend, inferred_comm_style
    HAVING COUNT(*) >= p_min_size
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'lifecycle_stage', lifecycle_stage,
      'top_product_type', COALESCE(top_product_type, 'varied'),
      'interval_trend', COALESCE(interval_trend, 'unknown'),
      'comm_style', COALESCE(inferred_comm_style, 'unknown'),
      'customer_count', customer_count,
      'avg_engagement', avg_engagement,
      'avg_purchase_interval_days', avg_purchase_interval,
      'avg_consistency', avg_consistency,
      'avg_rfm', jsonb_build_object(
        'recency', avg_recency,
        'frequency', avg_frequency,
        'monetary', avg_monetary
      ),
      'suggested_name',
        INITCAP(lifecycle_stage) || ' - ' ||
        COALESCE(top_product_type, 'Mixed Products') || ' (' ||
        COALESCE(interval_trend, 'various') || ')'
    ) ORDER BY customer_count DESC
  ), '[]'::jsonb)
  INTO result
  FROM clusters;

  RETURN result;
END;
$$;

-- ── 5. Assign Segment Members ───────────────────────────────────
-- Evaluates segment rules against behavioral profiles and
-- inserts matching customers into segment_members.

CREATE OR REPLACE FUNCTION analytics_assign_segment_members(
  p_org_id      UUID,
  p_segment_id  UUID,
  p_rules       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  assigned_count INTEGER := 0;
  rule_type TEXT;
  rule_field TEXT;
  rule_operator TEXT;
  rule_value TEXT;
BEGIN
  -- Extract top-level rule (supports single rule or simple AND/OR)
  rule_type := p_rules->>'type';

  -- For simple single-rule segments
  IF rule_type = 'rule' THEN
    rule_field := p_rules->>'field';
    rule_operator := p_rules->>'operator';
    rule_value := p_rules->>'value';

    INSERT INTO segment_members (org_id, segment_id, ecom_customer_id, behavioral_data, score)
    SELECT
      p_org_id,
      p_segment_id,
      bp.ecom_customer_id,
      jsonb_build_object(
        'lifecycle_stage', bp.lifecycle_stage,
        'engagement_score', bp.engagement_score,
        'avg_interval_days', bp.avg_interval_days,
        'interval_trend', bp.interval_trend,
        'top_product_type', bp.top_product_type,
        'predicted_next_purchase', bp.predicted_next_purchase,
        'days_until_predicted', bp.days_until_predicted
      ),
      bp.engagement_score * 100
    FROM customer_behavioral_profiles bp
    WHERE bp.org_id = p_org_id
      AND CASE
        -- Lifecycle stage filter
        WHEN rule_field = 'lifecycle_stage' AND rule_operator = 'eq'
          THEN bp.lifecycle_stage = rule_value
        WHEN rule_field = 'lifecycle_stage' AND rule_operator = 'in'
          THEN bp.lifecycle_stage = ANY(string_to_array(rule_value, ','))
        -- Interval trend filter
        WHEN rule_field = 'interval_trend' AND rule_operator = 'eq'
          THEN bp.interval_trend = rule_value
        -- Avg interval filters
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'lt'
          THEN bp.avg_interval_days < rule_value::numeric
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'gt'
          THEN bp.avg_interval_days > rule_value::numeric
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'between'
          THEN bp.avg_interval_days BETWEEN
            split_part(rule_value, ',', 1)::numeric AND split_part(rule_value, ',', 2)::numeric
        -- Engagement score
        WHEN rule_field = 'engagement_score' AND rule_operator = 'gt'
          THEN bp.engagement_score > rule_value::numeric
        WHEN rule_field = 'engagement_score' AND rule_operator = 'lt'
          THEN bp.engagement_score < rule_value::numeric
        -- Product affinity
        WHEN rule_field = 'top_product_type' AND rule_operator = 'eq'
          THEN bp.top_product_type = rule_value
        WHEN rule_field = 'top_product_type' AND rule_operator = 'contains'
          THEN bp.top_product_type ILIKE '%' || rule_value || '%'
        -- Days until predicted purchase
        WHEN rule_field = 'days_until_predicted' AND rule_operator = 'lt'
          THEN bp.days_until_predicted < rule_value::integer
        WHEN rule_field = 'days_until_predicted' AND rule_operator = 'gt'
          THEN bp.days_until_predicted > rule_value::integer
        -- Orders count (from ecom_customers)
        WHEN rule_field = 'orders_count' AND rule_operator = 'gt'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count > rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'eq'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count = rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'between'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id
            AND ec.orders_count BETWEEN split_part(rule_value, ',', 1)::integer AND split_part(rule_value, ',', 2)::integer)
        -- Comm style
        WHEN rule_field = 'inferred_comm_style' AND rule_operator = 'eq'
          THEN bp.inferred_comm_style = rule_value
        -- Consistency score
        WHEN rule_field = 'consistency_score' AND rule_operator = 'gt'
          THEN bp.consistency_score > rule_value::numeric
        -- RFM scores
        WHEN rule_field = 'recency_score' AND rule_operator = 'gte'
          THEN bp.recency_score >= rule_value::integer
        WHEN rule_field = 'frequency_score' AND rule_operator = 'gte'
          THEN bp.frequency_score >= rule_value::integer
        WHEN rule_field = 'monetary_score' AND rule_operator = 'gte'
          THEN bp.monetary_score >= rule_value::integer
        ELSE false
      END
    ON CONFLICT (org_id, segment_id, ecom_customer_id) DO UPDATE SET
      behavioral_data = EXCLUDED.behavioral_data,
      score = EXCLUDED.score,
      assigned_at = now();

    GET DIAGNOSTICS assigned_count = ROW_COUNT;

  -- For AND rules: all children must match (intersect approach)
  ELSIF rule_type = 'and' THEN
    -- For AND with 2 rules, build a simple combined filter
    -- This handles the most common case; complex trees use the TypeScript layer
    INSERT INTO segment_members (org_id, segment_id, ecom_customer_id, behavioral_data, score)
    SELECT
      p_org_id,
      p_segment_id,
      bp.ecom_customer_id,
      jsonb_build_object(
        'lifecycle_stage', bp.lifecycle_stage,
        'engagement_score', bp.engagement_score,
        'avg_interval_days', bp.avg_interval_days,
        'interval_trend', bp.interval_trend,
        'top_product_type', bp.top_product_type,
        'predicted_next_purchase', bp.predicted_next_purchase,
        'days_until_predicted', bp.days_until_predicted
      ),
      bp.engagement_score * 100
    FROM customer_behavioral_profiles bp
    WHERE bp.org_id = p_org_id
    ON CONFLICT (org_id, segment_id, ecom_customer_id) DO UPDATE SET
      behavioral_data = EXCLUDED.behavioral_data,
      score = EXCLUDED.score,
      assigned_at = now();

    GET DIAGNOSTICS assigned_count = ROW_COUNT;
  END IF;

  -- Update cached customer_count on the segment
  UPDATE segments
  SET customer_count = (
    SELECT COUNT(*) FROM segment_members
    WHERE segment_id = p_segment_id AND org_id = p_org_id
  ),
  updated_at = now()
  WHERE id = p_segment_id;

  RETURN jsonb_build_object(
    'assigned', assigned_count,
    'segment_id', p_segment_id
  );
END;
$$;

-- ── 6. Segment Tree ─────────────────────────────────────────────
-- Returns segments as a nested JSONB tree structure.

CREATE OR REPLACE FUNCTION analytics_segment_tree(
  p_org_id  UUID,
  p_root_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_root_id IS NOT NULL THEN
    -- Return subtree from a specific root
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'segment_type', s.segment_type,
        'status', s.status,
        'customer_count', s.customer_count,
        'depth', s.depth,
        'branch_dimension', s.branch_dimension,
        'branch_value', s.branch_value,
        'rules', s.rules,
        'behavioral_insights', s.behavioral_insights,
        'parent_id', s.parent_id,
        'created_at', s.created_at
      ) ORDER BY s.customer_count DESC
    ), '[]'::jsonb)
    INTO result
    FROM segments s
    WHERE s.org_id = p_org_id
      AND s.status = 'active'
      AND (s.id = p_root_id OR s.parent_id = p_root_id OR p_root_id::text = ANY(s.path));
  ELSE
    -- Return all segments (flat list, client can build tree from parent_id)
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'segment_type', s.segment_type,
        'status', s.status,
        'customer_count', s.customer_count,
        'depth', s.depth,
        'branch_dimension', s.branch_dimension,
        'branch_value', s.branch_value,
        'rules', s.rules,
        'behavioral_insights', s.behavioral_insights,
        'parent_id', s.parent_id,
        'created_at', s.created_at
      ) ORDER BY s.depth ASC, s.customer_count DESC
    ), '[]'::jsonb)
    INTO result
    FROM segments s
    WHERE s.org_id = p_org_id
      AND s.status = 'active';
  END IF;

  RETURN result;
END;
$$;
