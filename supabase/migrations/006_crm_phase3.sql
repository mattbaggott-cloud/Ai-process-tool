/* ================================================================== */
/*  006_crm_phase3.sql                                                */
/*  Phase 3: Products, Deal Line Items, Company Assets                */
/* ================================================================== */

-- ── 1. crm_products ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sku         TEXT DEFAULT '',
  description TEXT DEFAULT '',
  category    TEXT DEFAULT '',
  unit_price  NUMERIC(12,2) DEFAULT 0,
  currency    TEXT DEFAULT 'USD',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE crm_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own products"
  ON crm_products FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 2. crm_deal_line_items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_deal_line_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id      UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES crm_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity     INTEGER DEFAULT 1,
  unit_price   NUMERIC(12,2) DEFAULT 0,
  discount     NUMERIC(5,2) DEFAULT 0,
  total        NUMERIC(12,2) DEFAULT 0,
  notes        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deal_line_items_deal ON crm_deal_line_items(deal_id);

ALTER TABLE crm_deal_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own deal line items"
  ON crm_deal_line_items FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 3. crm_company_assets ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_company_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES crm_products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  quantity      INTEGER DEFAULT 1,
  purchase_date TEXT DEFAULT '',
  renewal_date  TEXT DEFAULT '',
  annual_value  NUMERIC(12,2) DEFAULT 0,
  status        TEXT DEFAULT 'active',
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_company_assets_company ON crm_company_assets(company_id);

ALTER TABLE crm_company_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own company assets"
  ON crm_company_assets FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
