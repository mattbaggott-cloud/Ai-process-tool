-- 028: Extend segment member assignment to support ecom_customers fields
--      (total_spent, orders_count with gte/lte, and top-N by spend)
--      Also adds ON DELETE SET NULL for strategy_group_id FK

-- Fix strategy_group_id FK to cascade properly
ALTER TABLE email_customer_variants
  DROP CONSTRAINT IF EXISTS email_customer_variants_strategy_group_id_fkey;
ALTER TABLE email_customer_variants
  ADD CONSTRAINT email_customer_variants_strategy_group_id_fkey
  FOREIGN KEY (strategy_group_id) REFERENCES campaign_strategy_groups(id)
  ON DELETE SET NULL;

-- Replace the segment assignment function with extended field support
CREATE OR REPLACE FUNCTION analytics_assign_segment_members(
  p_org_id uuid,
  p_segment_id uuid,
  p_rules jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  assigned_count integer := 0;
  rule_type text;
  rule_field text;
  rule_operator text;
  rule_value text;
  child_rules jsonb;
BEGIN
  rule_type := p_rules->>'type';
  rule_field := p_rules->>'field';
  rule_operator := p_rules->>'operator';
  rule_value := p_rules->>'value';
  child_rules := p_rules->'children';

  -- Clear existing members for fresh computation
  DELETE FROM segment_members
  WHERE segment_id = p_segment_id AND org_id = p_org_id;

  IF rule_type = 'rule' THEN
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
        -- Lifecycle stage
        WHEN rule_field = 'lifecycle_stage' AND rule_operator = 'eq'
          THEN bp.lifecycle_stage = rule_value
        WHEN rule_field = 'lifecycle_stage' AND rule_operator = 'in'
          THEN bp.lifecycle_stage = ANY(string_to_array(rule_value, ','))
        -- Interval trend
        WHEN rule_field = 'interval_trend' AND rule_operator = 'eq'
          THEN bp.interval_trend = rule_value
        -- Average interval days
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'gt'
          THEN bp.avg_interval_days > rule_value::numeric
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'lt'
          THEN bp.avg_interval_days < rule_value::numeric
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'gte'
          THEN bp.avg_interval_days >= rule_value::numeric
        WHEN rule_field = 'avg_interval_days' AND rule_operator = 'lte'
          THEN bp.avg_interval_days <= rule_value::numeric
        -- Engagement score
        WHEN rule_field = 'engagement_score' AND rule_operator = 'gt'
          THEN bp.engagement_score > rule_value::numeric
        WHEN rule_field = 'engagement_score' AND rule_operator = 'lt'
          THEN bp.engagement_score < rule_value::numeric
        WHEN rule_field = 'engagement_score' AND rule_operator = 'gte'
          THEN bp.engagement_score >= rule_value::numeric
        WHEN rule_field = 'engagement_score' AND rule_operator = 'lte'
          THEN bp.engagement_score <= rule_value::numeric
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
        WHEN rule_field = 'days_until_predicted' AND rule_operator = 'lte'
          THEN bp.days_until_predicted <= rule_value::integer
        WHEN rule_field = 'days_until_predicted' AND rule_operator = 'gte'
          THEN bp.days_until_predicted >= rule_value::integer
        -- Orders count (from ecom_customers)
        WHEN rule_field = 'orders_count' AND rule_operator = 'gt'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count > rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'gte'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count >= rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'lt'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count < rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'lte'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count <= rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'eq'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.orders_count = rule_value::integer)
        WHEN rule_field = 'orders_count' AND rule_operator = 'between'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id
            AND ec.orders_count BETWEEN split_part(rule_value, ',', 1)::integer AND split_part(rule_value, ',', 2)::integer)
        -- Total spent (from ecom_customers) — NEW
        WHEN rule_field = 'total_spent' AND rule_operator = 'gt'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.total_spent > rule_value::numeric)
        WHEN rule_field = 'total_spent' AND rule_operator = 'gte'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.total_spent >= rule_value::numeric)
        WHEN rule_field = 'total_spent' AND rule_operator = 'lt'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.total_spent < rule_value::numeric)
        WHEN rule_field = 'total_spent' AND rule_operator = 'lte'
          THEN EXISTS (SELECT 1 FROM ecom_customers ec WHERE ec.id = bp.ecom_customer_id AND ec.total_spent <= rule_value::numeric)
        -- Top N by total_spent — NEW
        -- Usage: field="total_spent", operator="top", value="5" → top 5 spenders
        WHEN rule_field = 'total_spent' AND rule_operator = 'top'
          THEN bp.ecom_customer_id IN (
            SELECT ec.id FROM ecom_customers ec
            WHERE ec.org_id = p_org_id
            ORDER BY ec.total_spent DESC NULLS LAST
            LIMIT rule_value::integer
          )
        -- Top N by orders_count — NEW
        WHEN rule_field = 'orders_count' AND rule_operator = 'top'
          THEN bp.ecom_customer_id IN (
            SELECT ec.id FROM ecom_customers ec
            WHERE ec.org_id = p_org_id
            ORDER BY ec.orders_count DESC NULLS LAST
            LIMIT rule_value::integer
          )
        -- Comm style
        WHEN rule_field = 'inferred_comm_style' AND rule_operator = 'eq'
          THEN bp.inferred_comm_style = rule_value
        -- Consistency score
        WHEN rule_field = 'consistency_score' AND rule_operator = 'gt'
          THEN bp.consistency_score > rule_value::numeric
        WHEN rule_field = 'consistency_score' AND rule_operator = 'gte'
          THEN bp.consistency_score >= rule_value::numeric
        -- RFM scores
        WHEN rule_field = 'recency_score' AND rule_operator = 'gte'
          THEN bp.recency_score >= rule_value::integer
        WHEN rule_field = 'frequency_score' AND rule_operator = 'gte'
          THEN bp.frequency_score >= rule_value::integer
        WHEN rule_field = 'monetary_score' AND rule_operator = 'gte'
          THEN bp.monetary_score >= rule_value::integer
        WHEN rule_field = 'recency_score' AND rule_operator = 'lte'
          THEN bp.recency_score <= rule_value::integer
        WHEN rule_field = 'frequency_score' AND rule_operator = 'lte'
          THEN bp.frequency_score <= rule_value::integer
        WHEN rule_field = 'monetary_score' AND rule_operator = 'lte'
          THEN bp.monetary_score <= rule_value::integer
        ELSE false
      END
    ON CONFLICT (org_id, segment_id, ecom_customer_id) DO UPDATE SET
      behavioral_data = EXCLUDED.behavioral_data,
      score = EXCLUDED.score,
      assigned_at = now();

    GET DIAGNOSTICS assigned_count = ROW_COUNT;

  -- For AND rules: all children must match (intersect approach)
  ELSIF rule_type = 'and' THEN
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
  member_count = (
    SELECT COUNT(*) FROM segment_members
    WHERE segment_id = p_segment_id AND org_id = p_org_id
  ),
  updated_at = now()
  WHERE id = p_segment_id;

  RETURN assigned_count;
END;
$$;
