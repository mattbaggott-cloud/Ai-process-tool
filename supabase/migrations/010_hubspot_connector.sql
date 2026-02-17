-- ============================================================
-- 010_hubspot_connector.sql  --  HubSpot connector support
-- ============================================================

-- Index for fast lookups of HubSpot-linked records by hubspot_id in metadata
CREATE INDEX IF NOT EXISTS idx_crm_contacts_hubspot_id
  ON crm_contacts USING btree (((metadata->>'hubspot_id')));

CREATE INDEX IF NOT EXISTS idx_crm_companies_hubspot_id
  ON crm_companies USING btree (((metadata->>'hubspot_id')));

CREATE INDEX IF NOT EXISTS idx_crm_deals_hubspot_id
  ON crm_deals USING btree (((metadata->>'hubspot_id')));

-- Index for deduplication by email (contacts)
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email_dedup
  ON crm_contacts(user_id, lower(email))
  WHERE email != '';

-- Index for deduplication by domain (companies)
CREATE INDEX IF NOT EXISTS idx_crm_companies_domain_dedup
  ON crm_companies(user_id, lower(domain))
  WHERE domain != '';

-- Index for efficient sync queries: find records updated since last sync
CREATE INDEX IF NOT EXISTS idx_crm_contacts_updated
  ON crm_contacts(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_crm_companies_updated
  ON crm_companies(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_crm_deals_updated
  ON crm_deals(user_id, updated_at);
