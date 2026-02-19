/* ================================================================
   Migration 018 — Customer Identity Links

   Creates a linking layer between CRM contacts and e-commerce customers.
   When data comes in from Shopify (ecom_customers) and also lives in CRM
   (crm_contacts), we need to know they're the same person.

   The identity link enables:
   - "Is this person a customer or a lead?" (has orders? → customer)
   - "Show me CRM contacts who have never purchased"
   - "Show me Shopify customers not in our CRM"
   - Unified graph view: CRM contact ↔ ecom customer
   - Cross-silo segmentation for Klaviyo/Meta Ads

   Match types:
   - 'email_exact': case-insensitive email match (highest confidence)
   - 'phone_match': phone number match
   - 'name_match': first_name + last_name fuzzy match
   - 'manual': user manually linked them

   The AI auto-links after each Shopify sync via email matching.
   ================================================================ */

-- ── Customer Identity Links ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_identity_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  crm_contact_id      UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  ecom_customer_id    UUID NOT NULL REFERENCES ecom_customers(id) ON DELETE CASCADE,
  match_type          TEXT NOT NULL DEFAULT 'email_exact'
                      CHECK (match_type IN ('email_exact', 'phone_match', 'name_match', 'manual')),
  confidence          NUMERIC(3,2) NOT NULL DEFAULT 1.0
                      CHECK (confidence >= 0 AND confidence <= 1),
  matched_on          TEXT,                -- the actual value matched (e.g. the email address)
  is_active           BOOLEAN NOT NULL DEFAULT true,
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by           UUID REFERENCES auth.users(id),  -- null = auto-linked

  -- Prevent duplicate links between same contact-customer pair
  UNIQUE(org_id, crm_contact_id, ecom_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_links_org ON customer_identity_links(org_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_crm ON customer_identity_links(org_id, crm_contact_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_ecom ON customer_identity_links(org_id, ecom_customer_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_active ON customer_identity_links(org_id, is_active) WHERE is_active = true;

-- ── Computed Classification View ─────────────────────────────────
-- This view provides a unified customer classification:
-- - "customer": has ecom_customer with orders_count > 0
-- - "lead": in CRM only, no purchase history
-- - "prospect": in CRM and ecom, but 0 orders
-- - "ecom_only": in ecom but not in CRM

CREATE OR REPLACE VIEW unified_customers AS
SELECT
  c.id AS crm_contact_id,
  c.org_id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.status AS crm_status,
  c.source AS crm_source,
  c.tags AS crm_tags,
  c.title,
  c.company_id,
  ec.id AS ecom_customer_id,
  ec.external_id AS ecom_external_id,
  ec.external_source,
  ec.orders_count,
  ec.total_spent,
  ec.avg_order_value,
  ec.first_order_at,
  ec.last_order_at,
  ec.accepts_marketing,
  ec.tags AS ecom_tags,
  link.id AS link_id,
  link.match_type,
  link.confidence,
  CASE
    WHEN ec.id IS NOT NULL AND ec.orders_count > 0 THEN 'customer'
    WHEN ec.id IS NOT NULL AND ec.orders_count = 0 THEN 'prospect'
    ELSE 'lead'
  END AS classification,
  COALESCE(c.updated_at, ec.updated_at) AS last_updated
FROM crm_contacts c
LEFT JOIN customer_identity_links link
  ON link.crm_contact_id = c.id
  AND link.is_active = true
LEFT JOIN ecom_customers ec
  ON link.ecom_customer_id = ec.id

UNION ALL

-- E-commerce customers with no CRM link (ecom-only)
SELECT
  NULL AS crm_contact_id,
  ec.org_id,
  ec.first_name,
  ec.last_name,
  ec.email,
  ec.phone,
  NULL AS crm_status,
  NULL AS crm_source,
  NULL AS crm_tags,
  NULL AS title,
  NULL AS company_id,
  ec.id AS ecom_customer_id,
  ec.external_id AS ecom_external_id,
  ec.external_source,
  ec.orders_count,
  ec.total_spent,
  ec.avg_order_value,
  ec.first_order_at,
  ec.last_order_at,
  ec.accepts_marketing,
  ec.tags AS ecom_tags,
  NULL AS link_id,
  NULL AS match_type,
  NULL AS confidence,
  'ecom_only' AS classification,
  ec.updated_at AS last_updated
FROM ecom_customers ec
WHERE NOT EXISTS (
  SELECT 1 FROM customer_identity_links link
  WHERE link.ecom_customer_id = ec.id
  AND link.is_active = true
);

-- ── RLS Policies ────────────────────────────────────────────────

ALTER TABLE customer_identity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read identity links"
  ON customer_identity_links FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert identity links"
  ON customer_identity_links FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update identity links"
  ON customer_identity_links FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- ── Comments ────────────────────────────────────────────────────

COMMENT ON TABLE customer_identity_links IS 'Links CRM contacts to e-commerce customers for unified identity resolution';
COMMENT ON VIEW unified_customers IS 'Unified view classifying all people as customer, lead, prospect, or ecom_only';
COMMENT ON COLUMN customer_identity_links.match_type IS 'How the link was established: email_exact, phone_match, name_match, or manual';
COMMENT ON COLUMN customer_identity_links.confidence IS 'Confidence score 0.0-1.0 (email_exact=1.0, phone=0.9, name=0.7)';
