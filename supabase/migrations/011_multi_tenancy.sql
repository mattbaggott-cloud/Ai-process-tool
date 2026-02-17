/* ================================================================== */
/*  011_multi_tenancy.sql                                             */
/*  Multi-Tenancy & RBAC: Organizations, Members, Departments         */
/*  Adds org_id to ALL existing tables, rewrites ALL RLS policies     */
/* ================================================================== */

-- ============================================================
-- PART 1: Create new multi-tenancy tables
-- ============================================================

CREATE TABLE orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'manager', 'user', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE TABLE org_departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

CREATE TABLE org_department_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   UUID NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'manager', 'user', 'viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, user_id)
);

CREATE TABLE org_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'manager', 'user', 'viewer')),
  department_ids  UUID[] DEFAULT '{}',
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for new tables
CREATE INDEX idx_org_members_user    ON org_members(user_id);
CREATE INDEX idx_org_members_org     ON org_members(org_id);
CREATE INDEX idx_org_departments_org ON org_departments(org_id);
CREATE INDEX idx_org_dept_members_dept ON org_department_members(department_id);
CREATE INDEX idx_org_dept_members_user ON org_department_members(user_id);
CREATE INDEX idx_org_invites_email   ON org_invites(email);
CREATE INDEX idx_org_invites_org     ON org_invites(org_id);

-- ============================================================
-- PART 2: RLS helper functions
-- ============================================================

-- Check if the current user is a member of the given org
CREATE OR REPLACE FUNCTION user_is_org_member(check_org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if the current user has at least the given role level in an org
-- Role hierarchy: owner(5) > admin(4) > manager(3) > user(2) > viewer(1)
CREATE OR REPLACE FUNCTION user_has_org_role(check_org_id UUID, min_role TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org_id
      AND user_id = auth.uid()
      AND CASE role
            WHEN 'owner'   THEN 5
            WHEN 'admin'   THEN 4
            WHEN 'manager' THEN 3
            WHEN 'user'    THEN 2
            WHEN 'viewer'  THEN 1
            ELSE 0
          END
          >=
          CASE min_role
            WHEN 'owner'   THEN 5
            WHEN 'admin'   THEN 4
            WHEN 'manager' THEN 3
            WHEN 'user'    THEN 2
            WHEN 'viewer'  THEN 1
            ELSE 0
          END
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PART 3: Rename conflicting tables
-- ============================================================

-- The existing "organizations" table stores company profile info for AI context.
-- Rename to avoid confusion with the new "orgs" multi-tenancy table.
ALTER TABLE organizations RENAME TO org_profiles;
ALTER TABLE organization_files RENAME TO org_profile_files;

-- ============================================================
-- PART 4: Add org_id column to ALL existing tables
-- ============================================================

-- Phase 1 tables (001_pending_tables.sql)
ALTER TABLE user_profiles     ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE pain_points       ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE dashboards        ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Renamed tables
ALTER TABLE org_profiles      ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE org_profile_files ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Goals (created via Supabase dashboard, not in migration files)
ALTER TABLE goals             ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE sub_goals         ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Teams (created via Supabase dashboard)
ALTER TABLE teams             ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE team_roles        ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE team_kpis         ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE team_tools        ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE team_files        ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Tool catalog & stack (created via Supabase dashboard)
ALTER TABLE tool_catalog      ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE user_stack_tools  ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Projects (created via Supabase dashboard)
ALTER TABLE projects          ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Library (created via Supabase dashboard)
ALTER TABLE library_items     ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE library_files     ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Vector search / RAG (002_vector_search.sql)
ALTER TABLE document_chunks   ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE llm_logs          ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- CRM (003_crm_tables.sql)
ALTER TABLE crm_companies     ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE crm_contacts      ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE crm_deals         ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE crm_activities    ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- CRM Phase 2 (005_crm_upgrade.sql)
ALTER TABLE crm_deal_stage_history ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- CRM Phase 3 (006_crm_phase3.sql)
ALTER TABLE crm_products         ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE crm_deal_line_items  ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE crm_company_assets   ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Data Home (007_data_home.sql)
ALTER TABLE data_connectors   ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE data_imports      ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE data_sync_log     ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Custom fields (008_crm_custom_fields.sql)
ALTER TABLE crm_custom_fields ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- Reports (009_crm_reports.sql)
ALTER TABLE crm_reports       ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- ============================================================
-- PART 5: Data migration — create orgs for existing users
-- ============================================================

-- Create an org for each existing user
INSERT INTO orgs (id, name, slug, owner_id)
SELECT
  gen_random_uuid(),
  COALESCE(p.display_name, split_part(u.email, '@', 1)) || '''s Workspace',
  LOWER(REGEXP_REPLACE(
    COALESCE(p.display_name, split_part(u.email, '@', 1)),
    '[^a-zA-Z0-9]', '-', 'g'
  )) || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8),
  u.id
FROM auth.users u
LEFT JOIN user_profiles p ON p.user_id = u.id;

-- Make each user an owner of their org
INSERT INTO org_members (id, org_id, user_id, role)
SELECT gen_random_uuid(), o.id, o.owner_id, 'owner'
FROM orgs o;

-- ============================================================
-- PART 6: Backfill org_id on ALL existing data
-- ============================================================

-- Helper: for tables with user_id, set org_id from the user's org
-- (Each user has exactly one org at this point)

UPDATE user_profiles SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = user_profiles.user_id
) WHERE org_id IS NULL;

UPDATE pain_points SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = pain_points.user_id
) WHERE org_id IS NULL;

UPDATE dashboards SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = dashboards.user_id
) WHERE org_id IS NULL;

UPDATE org_profiles SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = org_profiles.user_id
) WHERE org_id IS NULL;

UPDATE org_profile_files SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = org_profile_files.user_id
) WHERE org_id IS NULL;

UPDATE goals SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = goals.user_id
) WHERE org_id IS NULL;

-- sub_goals don't have user_id — backfill from parent goal
UPDATE sub_goals SET org_id = (
  SELECT g.org_id FROM goals g WHERE g.id = sub_goals.goal_id
) WHERE org_id IS NULL;

UPDATE teams SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = teams.user_id
) WHERE org_id IS NULL;

-- team child tables: backfill from parent team
UPDATE team_roles SET org_id = (
  SELECT t.org_id FROM teams t WHERE t.id = team_roles.team_id
) WHERE org_id IS NULL;

UPDATE team_kpis SET org_id = (
  SELECT t.org_id FROM teams t WHERE t.id = team_kpis.team_id
) WHERE org_id IS NULL;

UPDATE team_tools SET org_id = (
  SELECT t.org_id FROM teams t WHERE t.id = team_tools.team_id
) WHERE org_id IS NULL;

UPDATE team_files SET org_id = (
  SELECT t.org_id FROM teams t WHERE t.id = team_files.team_id
) WHERE org_id IS NULL;

UPDATE tool_catalog SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = tool_catalog.user_id
) WHERE org_id IS NULL;

UPDATE user_stack_tools SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = user_stack_tools.user_id
) WHERE org_id IS NULL;

UPDATE projects SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = projects.user_id
) WHERE org_id IS NULL;

UPDATE library_items SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = library_items.user_id
) WHERE org_id IS NULL;

UPDATE library_files SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = library_files.user_id
) WHERE org_id IS NULL;

UPDATE document_chunks SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = document_chunks.user_id
) WHERE org_id IS NULL;

UPDATE llm_logs SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = llm_logs.user_id
) WHERE org_id IS NULL;

UPDATE crm_companies SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_companies.user_id
) WHERE org_id IS NULL;

UPDATE crm_contacts SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_contacts.user_id
) WHERE org_id IS NULL;

UPDATE crm_deals SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_deals.user_id
) WHERE org_id IS NULL;

UPDATE crm_activities SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_activities.user_id
) WHERE org_id IS NULL;

UPDATE crm_deal_stage_history SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_deal_stage_history.user_id
) WHERE org_id IS NULL;

UPDATE crm_products SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_products.user_id
) WHERE org_id IS NULL;

UPDATE crm_deal_line_items SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_deal_line_items.user_id
) WHERE org_id IS NULL;

UPDATE crm_company_assets SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_company_assets.user_id
) WHERE org_id IS NULL;

UPDATE data_connectors SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = data_connectors.user_id
) WHERE org_id IS NULL;

UPDATE data_imports SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = data_imports.user_id
) WHERE org_id IS NULL;

UPDATE data_sync_log SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = data_sync_log.user_id
) WHERE org_id IS NULL;

UPDATE crm_custom_fields SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_custom_fields.user_id
) WHERE org_id IS NULL;

UPDATE crm_reports SET org_id = (
  SELECT o.id FROM orgs o WHERE o.owner_id = crm_reports.user_id
) WHERE org_id IS NULL;

-- ============================================================
-- PART 7: Add indexes on org_id for all tables
-- ============================================================

CREATE INDEX idx_user_profiles_org     ON user_profiles(org_id);
CREATE INDEX idx_pain_points_org       ON pain_points(org_id);
CREATE INDEX idx_dashboards_org        ON dashboards(org_id);
CREATE INDEX idx_org_profiles_org      ON org_profiles(org_id);
CREATE INDEX idx_org_profile_files_org ON org_profile_files(org_id);
CREATE INDEX idx_goals_org             ON goals(org_id);
CREATE INDEX idx_teams_org             ON teams(org_id);
CREATE INDEX idx_projects_org          ON projects(org_id);
CREATE INDEX idx_library_items_org     ON library_items(org_id);
CREATE INDEX idx_library_files_org     ON library_files(org_id);
CREATE INDEX idx_document_chunks_org   ON document_chunks(org_id);
CREATE INDEX idx_llm_logs_org          ON llm_logs(org_id);
CREATE INDEX idx_crm_companies_org     ON crm_companies(org_id);
CREATE INDEX idx_crm_contacts_org      ON crm_contacts(org_id);
CREATE INDEX idx_crm_deals_org         ON crm_deals(org_id);
CREATE INDEX idx_crm_activities_org    ON crm_activities(org_id);
CREATE INDEX idx_crm_deal_history_org  ON crm_deal_stage_history(org_id);
CREATE INDEX idx_crm_products_org      ON crm_products(org_id);
CREATE INDEX idx_data_connectors_org   ON data_connectors(org_id);
CREATE INDEX idx_crm_custom_fields_org ON crm_custom_fields(org_id);
CREATE INDEX idx_crm_reports_org       ON crm_reports(org_id);

-- ============================================================
-- PART 8: Drop ALL old RLS policies
-- ============================================================

-- 001: user_profiles
DROP POLICY IF EXISTS "Users can view own profile"      ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile"    ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile"    ON user_profiles;
DROP POLICY IF EXISTS "Users can delete own profile"    ON user_profiles;

-- 001: pain_points
DROP POLICY IF EXISTS "Users can view own pain points"  ON pain_points;
DROP POLICY IF EXISTS "Users can insert own pain points" ON pain_points;
DROP POLICY IF EXISTS "Users can update own pain points" ON pain_points;
DROP POLICY IF EXISTS "Users can delete own pain points" ON pain_points;

-- 001: dashboards
DROP POLICY IF EXISTS "Users can view own dashboards"   ON dashboards;
DROP POLICY IF EXISTS "Users can insert own dashboards"  ON dashboards;
DROP POLICY IF EXISTS "Users can update own dashboards"  ON dashboards;
DROP POLICY IF EXISTS "Users can delete own dashboards"  ON dashboards;

-- 002: document_chunks
DROP POLICY IF EXISTS "Users can view own chunks"       ON document_chunks;
DROP POLICY IF EXISTS "Users can insert own chunks"     ON document_chunks;
DROP POLICY IF EXISTS "Users can update own chunks"     ON document_chunks;
DROP POLICY IF EXISTS "Users can delete own chunks"     ON document_chunks;

-- 002: llm_logs
DROP POLICY IF EXISTS "Users can view own logs"         ON llm_logs;
DROP POLICY IF EXISTS "Users can insert own logs"       ON llm_logs;

-- 003: crm_companies
DROP POLICY IF EXISTS "Users can view own companies"    ON crm_companies;
DROP POLICY IF EXISTS "Users can insert own companies"  ON crm_companies;
DROP POLICY IF EXISTS "Users can update own companies"  ON crm_companies;
DROP POLICY IF EXISTS "Users can delete own companies"  ON crm_companies;

-- 003: crm_contacts
DROP POLICY IF EXISTS "Users can view own contacts"     ON crm_contacts;
DROP POLICY IF EXISTS "Users can insert own contacts"   ON crm_contacts;
DROP POLICY IF EXISTS "Users can update own contacts"   ON crm_contacts;
DROP POLICY IF EXISTS "Users can delete own contacts"   ON crm_contacts;

-- 003: crm_deals
DROP POLICY IF EXISTS "Users can view own deals"        ON crm_deals;
DROP POLICY IF EXISTS "Users can insert own deals"      ON crm_deals;
DROP POLICY IF EXISTS "Users can update own deals"      ON crm_deals;
DROP POLICY IF EXISTS "Users can delete own deals"      ON crm_deals;

-- 003: crm_activities
DROP POLICY IF EXISTS "Users can view own activities"   ON crm_activities;
DROP POLICY IF EXISTS "Users can insert own activities"  ON crm_activities;
DROP POLICY IF EXISTS "Users can update own activities"  ON crm_activities;
DROP POLICY IF EXISTS "Users can delete own activities"  ON crm_activities;

-- 005: crm_deal_stage_history
DROP POLICY IF EXISTS "Users see own deal stage history"    ON crm_deal_stage_history;
DROP POLICY IF EXISTS "Users insert own deal stage history"  ON crm_deal_stage_history;
DROP POLICY IF EXISTS "Users delete own deal stage history"  ON crm_deal_stage_history;

-- 006: crm_products, crm_deal_line_items, crm_company_assets
DROP POLICY IF EXISTS "Users manage own products"           ON crm_products;
DROP POLICY IF EXISTS "Users manage own deal line items"     ON crm_deal_line_items;
DROP POLICY IF EXISTS "Users manage own company assets"      ON crm_company_assets;

-- 007: data_connectors, data_imports, data_sync_log
DROP POLICY IF EXISTS "Users manage own connectors"    ON data_connectors;
DROP POLICY IF EXISTS "Users manage own imports"       ON data_imports;
DROP POLICY IF EXISTS "Users manage own sync log"      ON data_sync_log;

-- 008: crm_custom_fields
DROP POLICY IF EXISTS "Users manage own custom fields" ON crm_custom_fields;

-- 009: crm_reports
DROP POLICY IF EXISTS "Users manage own reports"       ON crm_reports;

-- Also drop any policies on tables created in Supabase dashboard
-- (these may or may not exist — IF EXISTS handles it)
DROP POLICY IF EXISTS "Users can view own goals"       ON goals;
DROP POLICY IF EXISTS "Users can insert own goals"     ON goals;
DROP POLICY IF EXISTS "Users can update own goals"     ON goals;
DROP POLICY IF EXISTS "Users can delete own goals"     ON goals;
DROP POLICY IF EXISTS "Users manage own goals"         ON goals;

DROP POLICY IF EXISTS "Users can view own sub_goals"   ON sub_goals;
DROP POLICY IF EXISTS "Users can insert own sub_goals"  ON sub_goals;
DROP POLICY IF EXISTS "Users can update own sub_goals"  ON sub_goals;
DROP POLICY IF EXISTS "Users can delete own sub_goals"  ON sub_goals;
DROP POLICY IF EXISTS "Users manage own sub_goals"      ON sub_goals;

DROP POLICY IF EXISTS "Users can view own teams"       ON teams;
DROP POLICY IF EXISTS "Users can insert own teams"     ON teams;
DROP POLICY IF EXISTS "Users can update own teams"     ON teams;
DROP POLICY IF EXISTS "Users can delete own teams"     ON teams;
DROP POLICY IF EXISTS "Users manage own teams"         ON teams;

DROP POLICY IF EXISTS "Users manage own team_roles"    ON team_roles;
DROP POLICY IF EXISTS "Users manage own team_kpis"     ON team_kpis;
DROP POLICY IF EXISTS "Users manage own team_tools"    ON team_tools;
DROP POLICY IF EXISTS "Users manage own team_files"    ON team_files;

DROP POLICY IF EXISTS "Users can view own team_roles"  ON team_roles;
DROP POLICY IF EXISTS "Users can insert own team_roles" ON team_roles;
DROP POLICY IF EXISTS "Users can update own team_roles" ON team_roles;
DROP POLICY IF EXISTS "Users can delete own team_roles" ON team_roles;

DROP POLICY IF EXISTS "Users can view own team_kpis"   ON team_kpis;
DROP POLICY IF EXISTS "Users can insert own team_kpis"  ON team_kpis;
DROP POLICY IF EXISTS "Users can update own team_kpis"  ON team_kpis;
DROP POLICY IF EXISTS "Users can delete own team_kpis"  ON team_kpis;

DROP POLICY IF EXISTS "Users can view own team_tools"  ON team_tools;
DROP POLICY IF EXISTS "Users can insert own team_tools" ON team_tools;
DROP POLICY IF EXISTS "Users can update own team_tools" ON team_tools;
DROP POLICY IF EXISTS "Users can delete own team_tools" ON team_tools;

DROP POLICY IF EXISTS "Users can view own team_files"  ON team_files;
DROP POLICY IF EXISTS "Users can insert own team_files" ON team_files;
DROP POLICY IF EXISTS "Users can update own team_files" ON team_files;
DROP POLICY IF EXISTS "Users can delete own team_files" ON team_files;

DROP POLICY IF EXISTS "Users manage own tool_catalog"  ON tool_catalog;
DROP POLICY IF EXISTS "Users can view own tool_catalog" ON tool_catalog;
DROP POLICY IF EXISTS "Users can insert own tool_catalog" ON tool_catalog;
DROP POLICY IF EXISTS "Users can update own tool_catalog" ON tool_catalog;
DROP POLICY IF EXISTS "Users can delete own tool_catalog" ON tool_catalog;

DROP POLICY IF EXISTS "Users manage own user_stack_tools" ON user_stack_tools;
DROP POLICY IF EXISTS "Users can view own user_stack_tools" ON user_stack_tools;
DROP POLICY IF EXISTS "Users can insert own user_stack_tools" ON user_stack_tools;
DROP POLICY IF EXISTS "Users can update own user_stack_tools" ON user_stack_tools;
DROP POLICY IF EXISTS "Users can delete own user_stack_tools" ON user_stack_tools;

DROP POLICY IF EXISTS "Users manage own projects"      ON projects;
DROP POLICY IF EXISTS "Users can view own projects"    ON projects;
DROP POLICY IF EXISTS "Users can insert own projects"   ON projects;
DROP POLICY IF EXISTS "Users can update own projects"   ON projects;
DROP POLICY IF EXISTS "Users can delete own projects"   ON projects;

DROP POLICY IF EXISTS "Users manage own library_items" ON library_items;
DROP POLICY IF EXISTS "Users can view own library_items" ON library_items;
DROP POLICY IF EXISTS "Users can insert own library_items" ON library_items;
DROP POLICY IF EXISTS "Users can update own library_items" ON library_items;
DROP POLICY IF EXISTS "Users can delete own library_items" ON library_items;

DROP POLICY IF EXISTS "Users manage own library_files" ON library_files;
DROP POLICY IF EXISTS "Users can view own library_files" ON library_files;
DROP POLICY IF EXISTS "Users can insert own library_files" ON library_files;
DROP POLICY IF EXISTS "Users can update own library_files" ON library_files;
DROP POLICY IF EXISTS "Users can delete own library_files" ON library_files;

-- Renamed tables
DROP POLICY IF EXISTS "Users can view own organizations"   ON org_profiles;
DROP POLICY IF EXISTS "Users can insert own organizations"  ON org_profiles;
DROP POLICY IF EXISTS "Users can update own organizations"  ON org_profiles;
DROP POLICY IF EXISTS "Users can delete own organizations"  ON org_profiles;
DROP POLICY IF EXISTS "Users manage own organizations"      ON org_profiles;
DROP POLICY IF EXISTS "Users can view own org_profiles"     ON org_profiles;
DROP POLICY IF EXISTS "Users manage own org_profiles"       ON org_profiles;

DROP POLICY IF EXISTS "Users can view own organization_files"   ON org_profile_files;
DROP POLICY IF EXISTS "Users can insert own organization_files"  ON org_profile_files;
DROP POLICY IF EXISTS "Users can update own organization_files"  ON org_profile_files;
DROP POLICY IF EXISTS "Users can delete own organization_files"  ON org_profile_files;
DROP POLICY IF EXISTS "Users manage own organization_files"      ON org_profile_files;
DROP POLICY IF EXISTS "Users can view own org_profile_files"     ON org_profile_files;
DROP POLICY IF EXISTS "Users manage own org_profile_files"       ON org_profile_files;

-- ============================================================
-- PART 9: Create NEW org-based RLS policies for ALL tables
-- ============================================================

-- === New multi-tenancy tables ===

-- orgs: members can see their orgs, owner can modify
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view org"
  ON orgs FOR SELECT
  USING (user_is_org_member(id));

CREATE POLICY "Owner can update org"
  ON orgs FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete org"
  ON orgs FOR DELETE
  USING (owner_id = auth.uid());

CREATE POLICY "Authenticated users can create orgs"
  ON orgs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- org_members: members can see all members, admin+ can manage
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view members"
  ON org_members FOR SELECT
  USING (user_is_org_member(org_id));

CREATE POLICY "Admin can insert members"
  ON org_members FOR INSERT
  WITH CHECK (user_has_org_role(org_id, 'admin'));

CREATE POLICY "Admin can update members"
  ON org_members FOR UPDATE
  USING (user_has_org_role(org_id, 'admin'));

CREATE POLICY "Admin can delete members"
  ON org_members FOR DELETE
  USING (user_has_org_role(org_id, 'admin'));

-- org_departments
ALTER TABLE org_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view departments"
  ON org_departments FOR SELECT
  USING (user_is_org_member(org_id));

CREATE POLICY "Admin can manage departments"
  ON org_departments FOR ALL
  USING (user_has_org_role(org_id, 'admin'))
  WITH CHECK (user_has_org_role(org_id, 'admin'));

-- org_department_members
ALTER TABLE org_department_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view dept members"
  ON org_department_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM org_departments d
    WHERE d.id = org_department_members.department_id
      AND user_is_org_member(d.org_id)
  ));

CREATE POLICY "Admin can manage dept members"
  ON org_department_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM org_departments d
    WHERE d.id = org_department_members.department_id
      AND user_has_org_role(d.org_id, 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM org_departments d
    WHERE d.id = org_department_members.department_id
      AND user_has_org_role(d.org_id, 'admin')
  ));

-- org_invites
ALTER TABLE org_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage invites"
  ON org_invites FOR ALL
  USING (user_has_org_role(org_id, 'admin'))
  WITH CHECK (user_has_org_role(org_id, 'admin'));

CREATE POLICY "Invited user can view own invite"
  ON org_invites FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- === Existing tables: new org-based policies ===

-- Pattern for most tables:
--   SELECT: org member (viewer+)
--   INSERT: org member with user role+ (can create)
--   UPDATE: org member with user role+ (can edit)
--   DELETE: org member with admin role+ (can delete)

-- user_profiles
CREATE POLICY "Org members view profiles"
  ON user_profiles FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert profiles"
  ON user_profiles FOR INSERT WITH CHECK (user_is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "Org users update profiles"
  ON user_profiles FOR UPDATE USING (user_is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "Org admins delete profiles"
  ON user_profiles FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- pain_points
CREATE POLICY "Org members view pain_points"
  ON pain_points FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert pain_points"
  ON pain_points FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update pain_points"
  ON pain_points FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete pain_points"
  ON pain_points FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- dashboards
CREATE POLICY "Org members view dashboards"
  ON dashboards FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert dashboards"
  ON dashboards FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update dashboards"
  ON dashboards FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete dashboards"
  ON dashboards FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- org_profiles (renamed from organizations)
CREATE POLICY "Org members view org_profiles"
  ON org_profiles FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert org_profiles"
  ON org_profiles FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update org_profiles"
  ON org_profiles FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete org_profiles"
  ON org_profiles FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- org_profile_files (renamed from organization_files)
CREATE POLICY "Org members view org_profile_files"
  ON org_profile_files FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert org_profile_files"
  ON org_profile_files FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update org_profile_files"
  ON org_profile_files FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete org_profile_files"
  ON org_profile_files FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- goals
CREATE POLICY "Org members view goals"
  ON goals FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert goals"
  ON goals FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update goals"
  ON goals FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete goals"
  ON goals FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- sub_goals
CREATE POLICY "Org members view sub_goals"
  ON sub_goals FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert sub_goals"
  ON sub_goals FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update sub_goals"
  ON sub_goals FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete sub_goals"
  ON sub_goals FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- teams
CREATE POLICY "Org members view teams"
  ON teams FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert teams"
  ON teams FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update teams"
  ON teams FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete teams"
  ON teams FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- team_roles
CREATE POLICY "Org members view team_roles"
  ON team_roles FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert team_roles"
  ON team_roles FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update team_roles"
  ON team_roles FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete team_roles"
  ON team_roles FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- team_kpis
CREATE POLICY "Org members view team_kpis"
  ON team_kpis FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert team_kpis"
  ON team_kpis FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update team_kpis"
  ON team_kpis FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete team_kpis"
  ON team_kpis FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- team_tools
CREATE POLICY "Org members view team_tools"
  ON team_tools FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert team_tools"
  ON team_tools FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update team_tools"
  ON team_tools FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete team_tools"
  ON team_tools FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- team_files
CREATE POLICY "Org members view team_files"
  ON team_files FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert team_files"
  ON team_files FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update team_files"
  ON team_files FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete team_files"
  ON team_files FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- tool_catalog
CREATE POLICY "Org members view tool_catalog"
  ON tool_catalog FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert tool_catalog"
  ON tool_catalog FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update tool_catalog"
  ON tool_catalog FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete tool_catalog"
  ON tool_catalog FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- user_stack_tools
CREATE POLICY "Org members view user_stack_tools"
  ON user_stack_tools FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert user_stack_tools"
  ON user_stack_tools FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update user_stack_tools"
  ON user_stack_tools FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete user_stack_tools"
  ON user_stack_tools FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- projects
CREATE POLICY "Org members view projects"
  ON projects FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert projects"
  ON projects FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update projects"
  ON projects FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete projects"
  ON projects FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- library_items
CREATE POLICY "Org members view library_items"
  ON library_items FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert library_items"
  ON library_items FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update library_items"
  ON library_items FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete library_items"
  ON library_items FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- library_files
CREATE POLICY "Org members view library_files"
  ON library_files FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert library_files"
  ON library_files FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update library_files"
  ON library_files FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete library_files"
  ON library_files FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- document_chunks
CREATE POLICY "Org members view document_chunks"
  ON document_chunks FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert document_chunks"
  ON document_chunks FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update document_chunks"
  ON document_chunks FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete document_chunks"
  ON document_chunks FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- llm_logs (insert-heavy, read by owner — but org-scoped for analytics)
CREATE POLICY "Org members view llm_logs"
  ON llm_logs FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert llm_logs"
  ON llm_logs FOR INSERT WITH CHECK (user_is_org_member(org_id));

-- crm_companies
CREATE POLICY "Org members view crm_companies"
  ON crm_companies FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_companies"
  ON crm_companies FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_companies"
  ON crm_companies FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_companies"
  ON crm_companies FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_contacts
CREATE POLICY "Org members view crm_contacts"
  ON crm_contacts FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_contacts"
  ON crm_contacts FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_contacts"
  ON crm_contacts FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_contacts"
  ON crm_contacts FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_deals
CREATE POLICY "Org members view crm_deals"
  ON crm_deals FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_deals"
  ON crm_deals FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_deals"
  ON crm_deals FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_deals"
  ON crm_deals FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_activities
CREATE POLICY "Org members view crm_activities"
  ON crm_activities FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_activities"
  ON crm_activities FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_activities"
  ON crm_activities FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_activities"
  ON crm_activities FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_deal_stage_history
CREATE POLICY "Org members view crm_deal_stage_history"
  ON crm_deal_stage_history FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_deal_stage_history"
  ON crm_deal_stage_history FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_deal_stage_history"
  ON crm_deal_stage_history FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_products
CREATE POLICY "Org members view crm_products"
  ON crm_products FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_products"
  ON crm_products FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_products"
  ON crm_products FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_products"
  ON crm_products FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_deal_line_items
CREATE POLICY "Org members view crm_deal_line_items"
  ON crm_deal_line_items FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_deal_line_items"
  ON crm_deal_line_items FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_deal_line_items"
  ON crm_deal_line_items FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_deal_line_items"
  ON crm_deal_line_items FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_company_assets
CREATE POLICY "Org members view crm_company_assets"
  ON crm_company_assets FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_company_assets"
  ON crm_company_assets FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_company_assets"
  ON crm_company_assets FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_company_assets"
  ON crm_company_assets FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- data_connectors
CREATE POLICY "Org members view data_connectors"
  ON data_connectors FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org admins insert data_connectors"
  ON data_connectors FOR INSERT WITH CHECK (user_has_org_role(org_id, 'admin'));
CREATE POLICY "Org admins update data_connectors"
  ON data_connectors FOR UPDATE USING (user_has_org_role(org_id, 'admin'));
CREATE POLICY "Org admins delete data_connectors"
  ON data_connectors FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- data_imports
CREATE POLICY "Org members view data_imports"
  ON data_imports FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert data_imports"
  ON data_imports FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update data_imports"
  ON data_imports FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete data_imports"
  ON data_imports FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- data_sync_log
CREATE POLICY "Org members view data_sync_log"
  ON data_sync_log FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert data_sync_log"
  ON data_sync_log FOR INSERT WITH CHECK (user_is_org_member(org_id));

-- crm_custom_fields
CREATE POLICY "Org members view crm_custom_fields"
  ON crm_custom_fields FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org admins insert crm_custom_fields"
  ON crm_custom_fields FOR INSERT WITH CHECK (user_has_org_role(org_id, 'admin'));
CREATE POLICY "Org admins update crm_custom_fields"
  ON crm_custom_fields FOR UPDATE USING (user_has_org_role(org_id, 'admin'));
CREATE POLICY "Org admins delete crm_custom_fields"
  ON crm_custom_fields FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- crm_reports
CREATE POLICY "Org members view crm_reports"
  ON crm_reports FOR SELECT USING (user_is_org_member(org_id));
CREATE POLICY "Org users insert crm_reports"
  ON crm_reports FOR INSERT WITH CHECK (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org users update crm_reports"
  ON crm_reports FOR UPDATE USING (user_has_org_role(org_id, 'user'));
CREATE POLICY "Org admins delete crm_reports"
  ON crm_reports FOR DELETE USING (user_has_org_role(org_id, 'admin'));

-- ============================================================
-- PART 10: Auto-create org for new signups (trigger)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user_org()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  slug_base TEXT;
BEGIN
  slug_base := LOWER(REGEXP_REPLACE(
    split_part(NEW.email, '@', 1),
    '[^a-z0-9]', '-', 'g'
  )) || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8);

  INSERT INTO public.orgs (id, name, slug, owner_id)
  VALUES (gen_random_uuid(), split_part(NEW.email, '@', 1) || '''s Workspace', slug_base, NEW.id)
  RETURNING id INTO new_org_id;

  INSERT INTO public.org_members (id, org_id, user_id, role)
  VALUES (gen_random_uuid(), new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if it already exists from a previous attempt
DROP TRIGGER IF EXISTS on_auth_user_created_org ON auth.users;

CREATE TRIGGER on_auth_user_created_org
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_org();
