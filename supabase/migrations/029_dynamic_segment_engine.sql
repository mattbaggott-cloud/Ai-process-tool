-- 029: Dynamic Segment Engine
--
-- Replaces the static CASE-based analytics_assign_segment_members with a
-- dynamic SQL engine that introspects actual column names at runtime.
--
-- ANY column on customer_behavioral_profiles or ecom_customers can now be
-- used as a segment rule field — no code changes required when new columns
-- are added. Supports operators: eq, neq, gt, gte, lt, lte, in, contains,
-- between, top.
--
-- AI-first: if the AI says field="total_spent" operator="top" value="5",
-- the engine resolves "total_spent" to the ecom_customers table automatically.

-- ══════════════════════════════════════════════════════════════
-- Step 1: Drop old functions (order matters — main first, then helpers)
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS analytics_assign_segment_members(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS _build_group_condition(jsonb, text, uuid);
DROP FUNCTION IF EXISTS _build_rule_condition(jsonb, uuid);
DROP FUNCTION IF EXISTS _resolve_field_type(text, text);
DROP FUNCTION IF EXISTS _resolve_field_table(text);

-- ══════════════════════════════════════════════════════════════
-- Step 2: Create helper functions (MUST come before main function)
-- ══════════════════════════════════════════════════════════════

-- Helper: resolve which table alias a field belongs to
-- Returns 'bp' for behavioral profiles, 'ec' for ecom_customers
CREATE OR REPLACE FUNCTION _resolve_field_table(p_field text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Check customer_behavioral_profiles first (primary table)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_behavioral_profiles'
      AND column_name = p_field
  ) THEN
    RETURN 'bp';
  END IF;

  -- Check ecom_customers
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ecom_customers'
      AND column_name = p_field
  ) THEN
    RETURN 'ec';
  END IF;

  -- Field not found in either table — return NULL
  RETURN NULL;
END;
$$;


-- Helper: get the PostgreSQL data type of a column
CREATE OR REPLACE FUNCTION _resolve_field_type(p_field text, p_table_alias text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tbl_name text;
  col_type text;
BEGIN
  IF p_table_alias = 'bp' THEN
    tbl_name := 'customer_behavioral_profiles';
  ELSE
    tbl_name := 'ecom_customers';
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = tbl_name
    AND column_name = p_field;

  RETURN col_type;
END;
$$;


-- Helper: build a single rule condition
CREATE OR REPLACE FUNCTION _build_rule_condition(p_rule jsonb, p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  rule_field text;
  rule_operator text;
  rule_value text;
  tbl_alias text;
  col_ref text;
  col_type text;
  cast_type text;
  safe_value text;
BEGIN
  rule_field    := p_rule->>'field';
  rule_operator := p_rule->>'operator';
  rule_value    := p_rule->>'value';

  -- Resolve which table the field lives on
  tbl_alias := _resolve_field_table(rule_field);

  -- If field doesn't exist in either table, include all customers
  -- (AI-first: never silently exclude — the AI requested this field,
  --  so we assume it makes sense and return all rather than none)
  IF tbl_alias IS NULL THEN
    RAISE NOTICE 'Segment rule field "%" not found in any customer table — including all customers', rule_field;
    RETURN 'true';
  END IF;

  col_ref := tbl_alias || '.' || quote_ident(rule_field);
  col_type := _resolve_field_type(rule_field, tbl_alias);

  -- Determine cast type based on column data type
  IF col_type IN ('integer', 'smallint', 'bigint') THEN
    cast_type := 'integer';
  ELSIF col_type IN ('numeric', 'real', 'double precision') THEN
    cast_type := 'numeric';
  ELSIF col_type IN ('boolean') THEN
    cast_type := 'boolean';
  ELSE
    cast_type := 'text';
  END IF;

  safe_value := quote_literal(rule_value);

  -- ── Special: "top" operator ──
  -- Returns top N customers ranked by field descending
  IF rule_operator = 'top' THEN
    IF tbl_alias = 'ec' THEN
      RETURN format(
        'ec.id IN (SELECT sub_ec.id FROM ecom_customers sub_ec WHERE sub_ec.org_id = %L ORDER BY sub_ec.%I DESC NULLS LAST LIMIT %s)',
        p_org_id, rule_field, rule_value
      );
    ELSE
      RETURN format(
        'bp.ecom_customer_id IN (SELECT sub_bp.ecom_customer_id FROM customer_behavioral_profiles sub_bp WHERE sub_bp.org_id = %L ORDER BY sub_bp.%I DESC NULLS LAST LIMIT %s)',
        p_org_id, rule_field, rule_value
      );
    END IF;
  END IF;

  -- ── Standard comparison operators ──
  CASE rule_operator
    WHEN 'eq' THEN
      IF cast_type = 'text' THEN
        RETURN format('%s = %s', col_ref, safe_value);
      ELSE
        RETURN format('%s = %s::%s', col_ref, safe_value, cast_type);
      END IF;

    WHEN 'neq' THEN
      IF cast_type = 'text' THEN
        RETURN format('%s != %s', col_ref, safe_value);
      ELSE
        RETURN format('%s != %s::%s', col_ref, safe_value, cast_type);
      END IF;

    WHEN 'gt' THEN
      RETURN format('%s > %s::%s', col_ref, safe_value, cast_type);

    WHEN 'gte' THEN
      RETURN format('%s >= %s::%s', col_ref, safe_value, cast_type);

    WHEN 'lt' THEN
      RETURN format('%s < %s::%s', col_ref, safe_value, cast_type);

    WHEN 'lte' THEN
      RETURN format('%s <= %s::%s', col_ref, safe_value, cast_type);

    WHEN 'in' THEN
      RETURN format('%s = ANY(string_to_array(%s, %L))', col_ref, safe_value, ',');

    WHEN 'contains' THEN
      RETURN format('%s ILIKE %s', col_ref, quote_literal('%' || rule_value || '%'));

    WHEN 'between' THEN
      RETURN format(
        '%s BETWEEN split_part(%s, %L, 1)::%s AND split_part(%s, %L, 2)::%s',
        col_ref, safe_value, ',', cast_type, safe_value, ',', cast_type
      );

    ELSE
      -- Unknown operator — include all (never silently exclude)
      RAISE NOTICE 'Unknown segment operator "%" — including all customers', rule_operator;
      RETURN 'true';
  END CASE;
END;
$$;


-- Helper: build AND/OR group condition from children
CREATE OR REPLACE FUNCTION _build_group_condition(p_rules jsonb, p_logic text, p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  children jsonb;
  child jsonb;
  child_type text;
  conditions text[] := '{}';
  cond text;
BEGIN
  children := p_rules->'children';

  IF children IS NULL OR jsonb_array_length(children) = 0 THEN
    RETURN 'true';
  END IF;

  FOR child IN SELECT jsonb_array_elements(children)
  LOOP
    child_type := child->>'type';

    IF child_type = 'rule' THEN
      cond := _build_rule_condition(child, p_org_id);
    ELSIF child_type = 'and' THEN
      cond := _build_group_condition(child, 'AND', p_org_id);
    ELSIF child_type = 'or' THEN
      cond := _build_group_condition(child, 'OR', p_org_id);
    ELSE
      cond := 'true';
    END IF;

    conditions := array_append(conditions, '(' || cond || ')');
  END LOOP;

  IF array_length(conditions, 1) = 0 THEN
    RETURN 'true';
  END IF;

  RETURN array_to_string(conditions, ' ' || p_logic || ' ');
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- Step 3: Create main function (AFTER helpers exist)
-- ══════════════════════════════════════════════════════════════

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
  dyn_sql text;
  where_clause text;
BEGIN
  rule_type := p_rules->>'type';

  -- Clear existing members for fresh computation
  DELETE FROM segment_members
  WHERE segment_id = p_segment_id AND org_id = p_org_id;

  IF rule_type = 'rule' THEN
    where_clause := _build_rule_condition(p_rules, p_org_id);
  ELSIF rule_type = 'and' THEN
    where_clause := _build_group_condition(p_rules, 'AND', p_org_id);
  ELSIF rule_type = 'or' THEN
    where_clause := _build_group_condition(p_rules, 'OR', p_org_id);
  ELSE
    where_clause := 'true';
  END IF;

  -- Build and execute dynamic INSERT
  dyn_sql := format(
    $SQL$
    INSERT INTO segment_members (org_id, segment_id, ecom_customer_id, behavioral_data, score)
    SELECT
      %L,
      %L,
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
      COALESCE(bp.engagement_score, 0) * 100
    FROM customer_behavioral_profiles bp
    LEFT JOIN ecom_customers ec ON ec.id = bp.ecom_customer_id AND ec.org_id = %L
    WHERE bp.org_id = %L
      AND (%s)
    ON CONFLICT (org_id, segment_id, ecom_customer_id) DO UPDATE SET
      behavioral_data = EXCLUDED.behavioral_data,
      score = EXCLUDED.score,
      assigned_at = now()
    $SQL$,
    p_org_id, p_segment_id, p_org_id, p_org_id, where_clause
  );

  EXECUTE dyn_sql;
  GET DIAGNOSTICS assigned_count = ROW_COUNT;

  -- Update cached customer_count on the segment
  UPDATE segments
  SET customer_count = assigned_count,
      member_count = assigned_count,
      updated_at = now()
  WHERE id = p_segment_id;

  RETURN assigned_count;
END;
$$;
