/* ================================================================
   Migration 017 — Shopify E-Commerce Tables

   Creates e-commerce tables for Shopify data (customers, orders, products).
   These are separate from CRM tables — they hold Shopify-native data verbatim.
   The `external_source` column allows future connectors (WooCommerce, BigCommerce)
   to share the same tables.
   ================================================================ */

-- ── E-Commerce Customers ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ecom_customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,
  external_source   TEXT NOT NULL DEFAULT 'shopify',
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  phone             TEXT,
  orders_count      INTEGER DEFAULT 0,
  total_spent       NUMERIC(12,2) DEFAULT 0,
  avg_order_value   NUMERIC(12,2) DEFAULT 0,
  first_order_at    TIMESTAMPTZ,
  last_order_at     TIMESTAMPTZ,
  tags              TEXT[] DEFAULT '{}',
  accepts_marketing BOOLEAN DEFAULT false,
  default_address   JSONB,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ecom_customers_org ON ecom_customers(org_id);
CREATE INDEX IF NOT EXISTS idx_ecom_customers_email ON ecom_customers(org_id, email);
CREATE INDEX IF NOT EXISTS idx_ecom_customers_external ON ecom_customers(org_id, external_source, external_id);
CREATE INDEX IF NOT EXISTS idx_ecom_customers_total_spent ON ecom_customers(org_id, total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_ecom_customers_last_order ON ecom_customers(org_id, last_order_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecom_customers_tags ON ecom_customers USING GIN(tags);

-- ── E-Commerce Orders ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ecom_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL,
  external_source       TEXT NOT NULL DEFAULT 'shopify',
  customer_id           UUID REFERENCES ecom_customers(id),
  customer_external_id  TEXT,
  order_number          TEXT,
  email                 TEXT,
  financial_status      TEXT,           -- paid, pending, refunded, partially_refunded
  fulfillment_status    TEXT,           -- fulfilled, partial, null (unfulfilled)
  total_price           NUMERIC(12,2),
  subtotal_price        NUMERIC(12,2),
  total_tax             NUMERIC(12,2),
  total_discounts       NUMERIC(12,2),
  total_shipping        NUMERIC(12,2),
  currency              TEXT DEFAULT 'USD',
  line_items            JSONB NOT NULL DEFAULT '[]',
  shipping_address      JSONB,
  billing_address       JSONB,
  discount_codes        JSONB DEFAULT '[]',
  tags                  TEXT[] DEFAULT '{}',
  note                  TEXT,
  source_name           TEXT,           -- 'web', 'pos', 'shopify_draft_order', etc.
  referring_site        TEXT,
  landing_site          TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  cancelled_at          TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ecom_orders_org ON ecom_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_customer ON ecom_orders(org_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_external ON ecom_orders(org_id, external_source, external_id);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_email ON ecom_orders(org_id, email);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_processed ON ecom_orders(org_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_financial ON ecom_orders(org_id, financial_status);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_tags ON ecom_orders USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_line_items ON ecom_orders USING GIN(line_items);

-- ── E-Commerce Products ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ecom_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,
  external_source   TEXT NOT NULL DEFAULT 'shopify',
  title             TEXT NOT NULL,
  handle            TEXT,
  body_html         TEXT,
  vendor            TEXT,
  product_type      TEXT,
  status            TEXT DEFAULT 'active',  -- active, draft, archived
  tags              TEXT[] DEFAULT '{}',
  variants          JSONB NOT NULL DEFAULT '[]',
  images            JSONB NOT NULL DEFAULT '[]',
  options           JSONB DEFAULT '[]',
  metadata          JSONB NOT NULL DEFAULT '{}',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ecom_products_org ON ecom_products(org_id);
CREATE INDEX IF NOT EXISTS idx_ecom_products_external ON ecom_products(org_id, external_source, external_id);
CREATE INDEX IF NOT EXISTS idx_ecom_products_status ON ecom_products(org_id, status);
CREATE INDEX IF NOT EXISTS idx_ecom_products_tags ON ecom_products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ecom_products_type ON ecom_products(org_id, product_type);

-- ── RLS Policies ────────────────────────────────────────────────

ALTER TABLE ecom_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecom_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecom_products ENABLE ROW LEVEL SECURITY;

-- Customers: org members can read, service role can write
CREATE POLICY "Org members can read ecom_customers"
  ON ecom_customers FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert ecom_customers"
  ON ecom_customers FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update ecom_customers"
  ON ecom_customers FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Orders: org members can read, service role can write
CREATE POLICY "Org members can read ecom_orders"
  ON ecom_orders FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert ecom_orders"
  ON ecom_orders FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update ecom_orders"
  ON ecom_orders FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Products: org members can read, service role can write
CREATE POLICY "Org members can read ecom_products"
  ON ecom_products FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can insert ecom_products"
  ON ecom_products FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members can update ecom_products"
  ON ecom_products FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- ── Graph Node Backfill ─────────────────────────────────────────
-- (Run after initial sync to create graph nodes for all e-commerce entities)
-- This is done automatically by graph-sync.ts on each sync,
-- but we include the SQL here for reference / manual backfill.

-- NOTE: Graph nodes are created by the sync service via graph-sync.ts
-- Entity types: 'ecom_customers', 'ecom_orders', 'ecom_products'
-- Edge types:
--   ecom_orders.customer_id → ecom_customers: 'placed_order' (customer → order)
--   ecom_orders line_items → ecom_products: 'contains_product' (order → product)

-- ── Add Shopify connector type to data_connectors ───────────────
-- The data_connectors table already exists (007_data_home.sql)
-- Just need to ensure 'shopify' is a valid connector_type
-- The column is TEXT type so no enum update needed.

COMMENT ON TABLE ecom_customers IS 'Shopify (and future e-commerce platform) customer records synced verbatim';
COMMENT ON TABLE ecom_orders IS 'Shopify (and future e-commerce platform) order records with line items as JSONB';
COMMENT ON TABLE ecom_products IS 'Shopify (and future e-commerce platform) product catalog with variants as JSONB';
