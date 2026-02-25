/**
 * Semantic Layer — business-term-to-SQL mappings
 *
 * Provides lookup functions for:
 * - Term matching (business terms → SQL conditions)
 * - Metric resolution (AOV, revenue, etc. → SQL expressions)
 * - Relationship paths (table A → table B JOIN instructions)
 * - JSONB access patterns
 * - Domain classification
 *
 * Data is defined inline (not YAML) to avoid runtime file reads
 * and work correctly with Next.js bundling.
 */

import type {
  SemanticLayer,
  SemanticMatch,
  JsonbPattern,
  FallbackPath,
  FieldConfidence,
  DataConfidence,
} from "./types";

/* ── Semantic Layer Data ──────────────────────────────── */

/**
 * The semantic layer definition.
 * YAML file is kept as documentation; this is the runtime source of truth.
 *
 * To add new platforms: add domain config + relevant terms below.
 */
const SEMANTIC_LAYER: SemanticLayer = {
  domains: {
    ecommerce: {
      tables: ["ecom_customers", "ecom_orders", "ecom_products"],
      description:
        "B2C customer data from Shopify — orders, products, customer profiles",
      primary_table: "ecom_customers",
    },
    crm: {
      tables: [
        "crm_contacts",
        "crm_companies",
        "crm_deals",
        "crm_activities",
        "crm_deal_line_items",
        "crm_company_assets",
      ],
      description:
        "B2B CRM data from HubSpot — contacts, companies, deals, activities",
      primary_table: "crm_contacts",
    },
    campaigns: {
      tables: [
        "email_campaigns",
        "email_customer_variants",
        "campaign_strategy_groups",
      ],
      description:
        "Email marketing campaigns and per-customer variant tracking",
      primary_table: "email_campaigns",
    },
    behavioral: {
      tables: [
        "customer_behavioral_profiles",
        "segments",
        "segment_members",
      ],
      description:
        "AI-computed customer behavior — lifecycle stages, RFM scores, engagement, segments",
      primary_table: "customer_behavioral_profiles",
    },
    identity: {
      tables: ["customer_identity_links"],
      description:
        "Identity resolution — links B2C ecommerce customers to B2B CRM contacts",
      primary_table: "customer_identity_links",
    },
  },

  terms: [
    // Customer value tiers
    {
      terms: ["VIP", "high value", "top customer", "best customer", "whale"],
      sql_condition: "total_spent > 500",
      table: "ecom_customers",
      description: "Customers with total spend above $500",
    },
    {
      terms: ["new customer", "first-time buyer"],
      sql_condition: "orders_count = 1",
      table: "ecom_customers",
      description: "Customers with exactly 1 order",
    },
    {
      terms: ["repeat customer", "returning customer"],
      sql_condition: "orders_count > 1",
      table: "ecom_customers",
      description: "Customers with more than 1 order",
    },
    {
      terms: ["inactive", "churned", "lost"],
      sql_condition: "lifecycle_stage IN ('lapsed', 'churned')",
      table: "customer_behavioral_profiles",
      description: "Customers who stopped purchasing",
    },
    {
      terms: ["at risk", "at-risk", "about to churn"],
      sql_condition: "lifecycle_stage = 'at_risk'",
      table: "customer_behavioral_profiles",
      description: "Customers showing signs of leaving",
    },
    {
      terms: ["champion", "most engaged"],
      sql_condition: "lifecycle_stage = 'champion'",
      table: "customer_behavioral_profiles",
      description: "Highest-value, most-engaged customers",
    },
    {
      terms: ["active", "engaged"],
      sql_condition: "lifecycle_stage IN ('active', 'loyal', 'champion')",
      table: "customer_behavioral_profiles",
      description: "Currently active customers",
    },

    // Product searches in order line items
    {
      terms: ["steak", "ribeye", "filet", "sirloin", "strip"],
      sql_condition: "item->>'title' ILIKE '%{term}%'",
      table: "ecom_orders",
      description:
        "Orders containing specific meat products — requires jsonb_array_elements(line_items)",
    },
    {
      terms: ["seafood", "salmon", "shrimp", "lobster", "crab"],
      sql_condition: "item->>'title' ILIKE '%{term}%'",
      table: "ecom_orders",
      description:
        "Orders containing seafood products — requires jsonb_array_elements(line_items)",
    },

    // Deal stages (CRM)
    {
      terms: ["open deal", "active deal", "in pipeline"],
      sql_condition: "stage NOT IN ('closed_won', 'closed_lost')",
      table: "crm_deals",
      description: "Deals still in the pipeline",
    },
    {
      terms: ["won deal", "closed won"],
      sql_condition: "stage = 'closed_won'",
      table: "crm_deals",
      description: "Deals that were won",
    },
    {
      terms: ["lost deal", "closed lost"],
      sql_condition: "stage = 'closed_lost'",
      table: "crm_deals",
      description: "Deals that were lost",
    },
    {
      terms: ["negotiation", "in negotiation"],
      sql_condition: "stage = 'negotiation'",
      table: "crm_deals",
      description: "Deals in negotiation stage",
    },

    // Purchase frequency / ordering patterns
    {
      terms: [
        "ordering schedule",
        "purchase frequency",
        "order frequency",
        "buying pattern",
        "purchase interval",
        "how often",
        "reorder rate",
        "order interval",
      ],
      sql_condition: "bp.avg_order_interval_days IS NOT NULL",
      table: "customer_behavioral_profiles",
      description:
        "Purchase frequency patterns. Use avg_order_interval_days, interval_trend, predicted_next_purchase from customer_behavioral_profiles. Alias as bp.",
    },
    {
      terms: [
        "inconsistent shopper",
        "irregular buyer",
        "erratic",
        "unpredictable buyer",
      ],
      sql_condition: "bp.interval_trend IN ('erratic', 'slowing')",
      table: "customer_behavioral_profiles",
      description:
        "Customers with unpredictable ordering intervals. Use interval_trend from customer_behavioral_profiles.",
    },
    {
      terms: [
        "consistent shopper",
        "regular buyer",
        "predictable buyer",
        "steady customer",
      ],
      sql_condition: "bp.interval_trend IN ('stable', 'accelerating')",
      table: "customer_behavioral_profiles",
      description:
        "Customers with stable or improving ordering intervals. Use interval_trend from customer_behavioral_profiles.",
    },

    // Campaign status
    {
      terms: ["sent campaign", "delivered campaign"],
      sql_condition: "delivery_status IN ('sent', 'delivered')",
      table: "email_customer_variants",
      description: "Campaign variants that were sent or delivered",
    },
    {
      terms: ["opened", "email opened"],
      sql_condition: "delivery_status = 'opened'",
      table: "email_customer_variants",
      description: "Campaign variants that were opened",
    },
    {
      terms: ["bounced", "email bounced"],
      sql_condition: "delivery_status = 'bounced'",
      table: "email_customer_variants",
      description: "Campaign variants that bounced",
    },
  ],

  metrics: [
    {
      name: "average_order_value",
      aliases: ["AOV", "average order value", "average order", "avg order value"],
      sql_expression: "AVG(total_price::numeric)",
      table: "ecom_orders",
      description: "Average dollar value per order",
    },
    {
      name: "total_revenue",
      aliases: ["total revenue", "total sales", "revenue"],
      sql_expression: "SUM(total_price::numeric)",
      table: "ecom_orders",
      description: "Sum of all order values",
    },
    {
      name: "order_count",
      aliases: ["number of orders", "order count", "how many orders"],
      sql_expression: "COUNT(*)",
      table: "ecom_orders",
      description: "Count of orders",
    },
    {
      name: "customer_count",
      aliases: ["number of customers", "customer count", "how many customers"],
      sql_expression: "COUNT(DISTINCT id)",
      table: "ecom_customers",
      description: "Count of unique customers",
    },
    {
      name: "deal_pipeline_value",
      aliases: ["pipeline value", "total pipeline", "deal value"],
      sql_expression: "SUM(value::numeric)",
      table: "crm_deals",
      description: "Sum of all deal values",
    },
    {
      name: "open_rate",
      aliases: ["open rate", "email open rate"],
      sql_expression:
        "ROUND(COUNT(*) FILTER (WHERE delivery_status = 'opened')::numeric / NULLIF(COUNT(*) FILTER (WHERE delivery_status IN ('sent','delivered','opened','clicked')), 0) * 100, 1)",
      table: "email_customer_variants",
      description: "Percentage of sent emails that were opened",
    },
  ],

  relationships: [
    {
      from_table: "ecom_customers",
      to_table: "ecom_orders",
      join_sql:
        "JOIN ecom_orders o ON o.customer_id = c.id AND o.org_id = c.org_id",
      description: "Customer to their orders",
    },
    {
      from_table: "ecom_customers",
      to_table: "customer_behavioral_profiles",
      join_sql:
        "JOIN customer_behavioral_profiles bp ON bp.ecom_customer_id = c.id AND bp.org_id = c.org_id",
      description:
        "Customer to their behavioral profile (lifecycle, RFM, engagement)",
    },
    {
      from_table: "ecom_customers",
      to_table: "segment_members",
      join_sql:
        "JOIN segment_members sm ON sm.ecom_customer_id = c.id AND sm.org_id = c.org_id",
      description: "Customer to their segment memberships",
    },
    {
      from_table: "segment_members",
      to_table: "segments",
      join_sql:
        "JOIN segments s ON s.id = sm.segment_id AND s.org_id = sm.org_id",
      description: "Segment membership to segment definition",
    },
    {
      from_table: "ecom_customers",
      to_table: "email_customer_variants",
      join_sql:
        "JOIN email_customer_variants ecv ON ecv.ecom_customer_id = c.id AND ecv.org_id = c.org_id",
      description: "Customer to their campaign variants",
    },
    {
      from_table: "email_customer_variants",
      to_table: "email_campaigns",
      join_sql:
        "JOIN email_campaigns ec ON ec.id = ecv.campaign_id AND ec.org_id = ecv.org_id",
      description: "Campaign variant to campaign definition",
    },
    {
      from_table: "ecom_customers",
      to_table: "customer_identity_links",
      join_sql:
        "JOIN customer_identity_links cil ON cil.ecom_customer_id = c.id AND cil.org_id = c.org_id",
      description: "Ecommerce customer to identity link",
    },
    {
      from_table: "customer_identity_links",
      to_table: "crm_contacts",
      join_sql:
        "JOIN crm_contacts cc ON cc.id = cil.crm_contact_id AND cc.org_id = cil.org_id",
      description: "Identity link to CRM contact (B2B <-> B2C bridge)",
    },
    {
      from_table: "crm_contacts",
      to_table: "crm_companies",
      join_sql:
        "JOIN crm_companies comp ON comp.id = cc.company_id AND comp.org_id = cc.org_id",
      description: "CRM contact to their company",
    },
    {
      from_table: "crm_contacts",
      to_table: "crm_deals",
      join_sql:
        "JOIN crm_deals d ON d.contact_id = cc.id AND d.org_id = cc.org_id",
      description: "CRM contact to their deals",
    },
    {
      from_table: "crm_deals",
      to_table: "crm_deal_line_items",
      join_sql:
        "JOIN crm_deal_line_items dli ON dli.deal_id = d.id AND dli.org_id = d.org_id",
      description: "Deal to its line items/products",
    },
    {
      from_table: "crm_contacts",
      to_table: "crm_activities",
      join_sql:
        "JOIN crm_activities ca ON ca.contact_id = cc.id AND ca.org_id = cc.org_id",
      description: "CRM contact to their logged activities",
    },
  ],

  jsonb_patterns: [
    {
      table: "ecom_customers",
      column: "default_address",
      keys: [
        "address1",
        "address2",
        "city",
        "province",
        "zip",
        "country",
        "phone",
        "company",
      ],
      access_pattern: "default_address->>'KEY'",
      description:
        "Customer shipping address. Replace KEY with field name: default_address->>'zip', default_address->>'city', etc.",
    },
    {
      table: "ecom_orders",
      column: "shipping_address",
      keys: ["address1", "address2", "city", "province", "zip", "country"],
      access_pattern: "shipping_address->>'KEY'",
      description: "Order shipping address. Replace KEY with field name.",
    },
    {
      table: "ecom_orders",
      column: "line_items",
      keys: [
        "title",
        "quantity",
        "price",
        "sku",
        "variant_id",
        "variant_title",
      ],
      access_pattern: "jsonb_array_elements(line_items)",
      description:
        "Order line items. Unnest with: jsonb_array_elements(line_items) AS item, then access item->>'title', (item->>'price')::numeric, etc.",
    },
    {
      table: "ecom_customers",
      column: "tags",
      keys: [],
      access_pattern: "tags",
      description: "Customer tags array. Filter with: 'tag_value' = ANY(tags)",
    },
    {
      table: "customer_behavioral_profiles",
      column: "product_affinities",
      keys: [
        "product_title",
        "product_type",
        "purchase_count",
        "pct_of_orders",
      ],
      access_pattern: "jsonb_array_elements(product_affinities)",
      description:
        "Customer product affinities. Unnest with jsonb_array_elements(product_affinities) AS pa.",
    },
  ],

  /* ── Phase 3: Fallback Paths ──────────────────────── */

  fallbacks: [
    {
      primary_table: "ecom_customers",
      primary_column: "default_address",
      fallback_table: "ecom_orders",
      fallback_column: "shipping_address",
      fallback_join:
        "LEFT JOIN LATERAL (SELECT o.shipping_address FROM ecom_orders o " +
        "WHERE o.customer_id = c.id AND o.org_id = c.org_id " +
        "ORDER BY o.created_at DESC LIMIT 1) latest_order ON true",
      coalesce_pattern:
        "COALESCE(c.default_address->>'KEY', latest_order.shipping_address->>'KEY')",
      description:
        "If customer has no default_address, fall back to shipping_address on their most recent order.",
    },
  ],

  /* ── Phase 3: Data Confidence Registry ────────────── */

  confidence_registry: [
    {
      table: "customer_behavioral_profiles",
      confidence: "ai_inferred",
      description:
        "AI-computed during profiling runs. Values reflect model predictions, not direct observations.",
      fields: [
        "lifecycle_stage",
        "communication_style",
        "engagement_score",
        "recency_score",
        "frequency_score",
        "monetary_score",
        "predicted_next_purchase",
        "product_affinities",
      ],
    },
    {
      table: "segments",
      confidence: "ai_inferred",
      description:
        "Segments are AI-discovered or rule-based. Membership is computed, not manually assigned.",
    },
    {
      table: "ecom_customers",
      confidence: "verified",
      description: "Imported from Shopify. Factual transaction data.",
    },
    {
      table: "ecom_orders",
      confidence: "verified",
      description: "Imported from Shopify. Factual order records.",
    },
    {
      table: "ecom_products",
      confidence: "verified",
      description: "Imported from Shopify. Product catalog data.",
    },
    {
      table: "crm_contacts",
      confidence: "verified",
      description: "Imported from CRM. User-entered contact data.",
    },
    {
      table: "crm_companies",
      confidence: "verified",
      description: "Imported from CRM. User-entered company data.",
    },
    {
      table: "crm_deals",
      confidence: "verified",
      description: "Imported from CRM. User-entered deal data.",
    },
    {
      table: "email_campaigns",
      confidence: "verified",
      description: "Campaign records with delivery and engagement data.",
    },
  ],
};

/* ── Public API ───────────────────────────────────────── */

/**
 * Load the semantic layer. Returns the singleton instance.
 */
export function loadSemanticLayer(): SemanticLayer {
  return SEMANTIC_LAYER;
}

/* ── Term Matching ────────────────────────────────────── */

/**
 * Find all business term matches in a question.
 * Returns SQL conditions that map to recognized terms.
 */
export function findTermMatches(
  question: string,
  layer: SemanticLayer
): SemanticMatch[] {
  const matches: SemanticMatch[] = [];
  const lowerQuestion = question.toLowerCase();

  // Check term mappings
  for (const mapping of layer.terms) {
    for (const term of mapping.terms) {
      if (lowerQuestion.includes(term.toLowerCase())) {
        // If the SQL has a {term} placeholder, replace it
        const sqlCondition = mapping.sql_condition.replace(
          "{term}",
          term.toLowerCase()
        );
        matches.push({
          term,
          sql_condition: sqlCondition,
          table: mapping.table,
          description: mapping.description,
        });
        break; // Only match the first term per mapping
      }
    }
  }

  // Check metric aliases
  for (const metric of layer.metrics) {
    for (const alias of metric.aliases) {
      if (lowerQuestion.includes(alias.toLowerCase())) {
        matches.push({
          term: alias,
          sql_condition: metric.sql_expression,
          table: metric.table,
          description: metric.description,
        });
        break;
      }
    }
  }

  return matches;
}

/* ── Relationship Path Lookup ────────────────────────── */

/**
 * Find the JOIN path between two tables.
 * Returns the JOIN SQL string, or null if no direct path exists.
 */
export function getRelationshipPath(
  fromTable: string,
  toTable: string,
  layer: SemanticLayer
): string | null {
  for (const rel of layer.relationships) {
    if (rel.from_table === fromTable && rel.to_table === toTable) {
      return rel.join_sql;
    }
  }
  return null;
}

/**
 * Find a multi-hop JOIN path between two tables.
 * Uses BFS to find the shortest path through relationship definitions.
 */
export function findJoinPath(
  fromTable: string,
  toTable: string,
  layer: SemanticLayer
): string[] {
  if (fromTable === toTable) return [];

  // Direct path check
  const direct = getRelationshipPath(fromTable, toTable, layer);
  if (direct) return [direct];

  // BFS for multi-hop
  const visited = new Set<string>([fromTable]);
  const queue: Array<{ table: string; path: string[] }> = [
    { table: fromTable, path: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const rel of layer.relationships) {
      if (rel.from_table === current.table && !visited.has(rel.to_table)) {
        const newPath = [...current.path, rel.join_sql];

        if (rel.to_table === toTable) {
          return newPath;
        }

        visited.add(rel.to_table);
        queue.push({ table: rel.to_table, path: newPath });
      }
    }
  }

  return []; // No path found
}

/* ── Domain Classification ───────────────────────────── */

/**
 * Classify which domain a question belongs to based on table mentions and terms.
 * Returns the most likely domain, or "all" if ambiguous.
 */
export function getDomainForQuestion(
  question: string,
  layer: SemanticLayer
): string {
  const lowerQuestion = question.toLowerCase();
  const domainScores: Record<string, number> = {};

  // Score based on term matches
  const matches = findTermMatches(question, layer);
  for (const match of matches) {
    if (match.table) {
      const domain = findDomainForTable(match.table, layer);
      if (domain) {
        domainScores[domain] = (domainScores[domain] || 0) + 1;
      }
    }
  }

  // Score based on keyword hints
  const domainKeywords: Record<string, string[]> = {
    ecommerce: [
      "order",
      "customer",
      "product",
      "shopify",
      "purchase",
      "spend",
      "revenue",
      "cart",
      "shipping",
      "b2c",
    ],
    crm: [
      "deal",
      "contact",
      "company",
      "pipeline",
      "hubspot",
      "b2b",
      "prospect",
      "lead",
      "opportunity",
      "account",
    ],
    campaigns: [
      "campaign",
      "email",
      "sent",
      "opened",
      "clicked",
      "bounced",
      "newsletter",
      "marketing",
    ],
    behavioral: [
      "segment",
      "lifecycle",
      "rfm",
      "engagement",
      "churn",
      "at risk",
      "behavioral",
    ],
  };

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    for (const kw of keywords) {
      if (lowerQuestion.includes(kw)) {
        domainScores[domain] = (domainScores[domain] || 0) + 1;
      }
    }
  }

  // Find top domain
  const sorted = Object.entries(domainScores).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return "all";
  if (sorted.length === 1) return sorted[0][0];

  // If top two are close (within 1 point), it's ambiguous
  if (sorted[0][1] - sorted[1][1] <= 1) return "all";

  return sorted[0][0];
}

/**
 * Find which domain a table belongs to.
 */
function findDomainForTable(
  tableName: string,
  layer: SemanticLayer
): string | null {
  for (const [domain, config] of Object.entries(layer.domains)) {
    if (config.tables.includes(tableName)) {
      return domain;
    }
  }
  return null;
}

/* ── JSONB Pattern Lookup ────────────────────────────── */

/**
 * Find JSONB access patterns relevant to a question.
 */
export function findJsonbPatterns(
  question: string,
  layer: SemanticLayer
): JsonbPattern[] {
  const lowerQuestion = question.toLowerCase();
  const relevant: JsonbPattern[] = [];

  for (const pattern of layer.jsonb_patterns) {
    // Check if the question mentions any of the JSONB keys
    for (const key of pattern.keys) {
      if (lowerQuestion.includes(key.toLowerCase())) {
        relevant.push(pattern);
        break;
      }
    }
    // Also check column name
    if (lowerQuestion.includes(pattern.column.toLowerCase())) {
      if (!relevant.includes(pattern)) {
        relevant.push(pattern);
      }
    }
  }

  return relevant;
}

/* ── Fallback Path Lookup ─────────────────────────────── */

/**
 * Find a fallback path for a column that might be null.
 * Returns the fallback config if one exists, null otherwise.
 *
 * Example: findFallbackPath("ecom_customers", "default_address", layer)
 * → returns the shipping_address fallback via LATERAL JOIN
 */
export function findFallbackPath(
  table: string,
  column: string,
  layer: SemanticLayer
): FallbackPath | null {
  for (const fb of layer.fallbacks) {
    if (fb.primary_table === table && fb.primary_column === column) {
      return fb;
    }
  }
  return null;
}

/* ── Data Confidence Lookup ───────────────────────────── */

/**
 * Get confidence metadata for fields based on their source tables.
 * Returns a FieldConfidence entry for each field that has non-default
 * confidence (i.e., ai_inferred or computed).
 *
 * Used by the presenter to annotate output with confidence indicators.
 */
export function getFieldConfidence(
  tables: string[],
  columns: string[],
  layer: SemanticLayer
): FieldConfidence[] {
  const results: FieldConfidence[] = [];

  for (const tableConfig of layer.confidence_registry) {
    if (!tables.includes(tableConfig.table)) continue;

    // If this table is verified, skip — we only annotate non-obvious confidence
    if (tableConfig.confidence === "verified") continue;

    if (tableConfig.fields && tableConfig.fields.length > 0) {
      // Specific fields on this table are flagged
      for (const field of tableConfig.fields) {
        if (columns.length === 0 || columns.includes(field)) {
          results.push({
            field,
            confidence: tableConfig.confidence,
            source_table: tableConfig.table,
            description: tableConfig.description,
          });
        }
      }
    } else {
      // Entire table has this confidence level — flag all requested columns
      // that came from this table
      for (const col of columns) {
        results.push({
          field: col,
          confidence: tableConfig.confidence,
          source_table: tableConfig.table,
          description: tableConfig.description,
        });
      }
    }
  }

  return results;
}
