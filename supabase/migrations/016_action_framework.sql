-- ============================================================
-- Phase 3: Action Framework + Policy Engine
-- ============================================================
-- Formalizes every operation with governance and full audit trail.
-- Three tables:
--   action_registry    — defines all possible actions (global)
--   action_executions  — records every execution (per-org)
--   action_policies    — per-org trust controls (allow/deny/require_approval)
-- ============================================================

-- ── 1. action_registry ──────────────────────────────────────
-- Global table: every operation formalized with schema, roles, side effects.
-- No org_id — these are system-wide definitions.

CREATE TABLE IF NOT EXISTS action_registry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name       TEXT NOT NULL UNIQUE,       -- 'crm.contact.create'
  category          TEXT NOT NULL,               -- 'crm', 'goals', 'teams', etc.
  display_name      TEXT NOT NULL,
  description       TEXT,
  input_schema      JSONB NOT NULL DEFAULT '{}', -- JSON Schema for input validation
  min_role          TEXT NOT NULL DEFAULT 'member', -- minimum org role required
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  side_effects      TEXT[] NOT NULL DEFAULT '{}', -- ['creates_record', 'sends_email', etc.]
  is_reversible     BOOLEAN NOT NULL DEFAULT false,
  ai_description    TEXT,                        -- description for AI tool selection
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_registry_category ON action_registry(category);
CREATE INDEX idx_action_registry_active ON action_registry(is_active) WHERE is_active = true;

-- ── 2. action_executions ────────────────────────────────────
-- Every execution recorded with full context, timing, and outcome.

CREATE TABLE IF NOT EXISTS action_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  action_name       TEXT NOT NULL,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('user', 'ai', 'system', 'connector')),
  actor_id          UUID,
  session_id        UUID,
  input             JSONB NOT NULL DEFAULT '{}',
  output            JSONB,
  status            TEXT NOT NULL DEFAULT 'executing'
                      CHECK (status IN ('pending', 'approved', 'executing', 'completed', 'failed', 'denied', 'rolled_back')),
  error             TEXT,
  policy_applied    TEXT,                        -- which policy was evaluated
  policy_effect     TEXT,                        -- 'allow', 'require_approval', 'deny'
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approved_by       UUID REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  event_id          UUID,                        -- links to events table
  entity_type       TEXT,                        -- what entity was affected
  entity_id         UUID,                        -- id of affected entity
  duration_ms       INTEGER,                     -- how long the action took
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_action_executions_org ON action_executions(org_id);
CREATE INDEX idx_action_executions_action ON action_executions(action_name);
CREATE INDEX idx_action_executions_actor ON action_executions(actor_id);
CREATE INDEX idx_action_executions_status ON action_executions(status);
CREATE INDEX idx_action_executions_started ON action_executions(started_at DESC);
CREATE INDEX idx_action_executions_session ON action_executions(session_id) WHERE session_id IS NOT NULL;

-- ── 3. action_policies ──────────────────────────────────────
-- Per-org trust controls with glob pattern matching and conditions.

CREATE TABLE IF NOT EXISTS action_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  action_pattern  TEXT NOT NULL,                 -- glob: 'crm.*', 'crm.deal.update_stage', '*'
  conditions      JSONB NOT NULL DEFAULT '{}',   -- e.g. {"actor_type":"ai","min_value":10000}
  effect          TEXT NOT NULL CHECK (effect IN ('allow', 'require_approval', 'deny')),
  approval_role   TEXT DEFAULT 'admin',
  priority        INTEGER NOT NULL DEFAULT 100,  -- lower = higher priority (first match wins)
  description     TEXT,                          -- human-readable policy description
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_action_policies_org ON action_policies(org_id);
CREATE INDEX idx_action_policies_active ON action_policies(org_id, is_active, priority)
  WHERE is_active = true;

-- ── 4. RLS Policies ─────────────────────────────────────────

ALTER TABLE action_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_policies ENABLE ROW LEVEL SECURITY;

-- action_registry: everyone can read (global definitions)
CREATE POLICY "action_registry_read" ON action_registry
  FOR SELECT USING (true);

-- action_executions: org members can read their org's executions
CREATE POLICY "action_executions_read" ON action_executions
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- action_executions: org members can insert (via the action executor)
CREATE POLICY "action_executions_insert" ON action_executions
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- action_executions: org members can update (to mark completed/failed)
CREATE POLICY "action_executions_update" ON action_executions
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- action_policies: org members can read their org's policies
CREATE POLICY "action_policies_read" ON action_policies
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- action_policies: only admins/owners can create policies
CREATE POLICY "action_policies_insert" ON action_policies
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- action_policies: only admins/owners can update policies
CREATE POLICY "action_policies_update" ON action_policies
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

-- No DELETE on any table — we never delete audit data

-- ── 5. Seed action_registry ─────────────────────────────────
-- Maps all existing tools from tool-executor.ts to formalized actions.

INSERT INTO action_registry (action_name, category, display_name, description, min_role, side_effects, is_reversible, ai_description) VALUES
  -- Team tools
  ('teams.create',             'teams',  'Create Team',              'Create a new team with name and description',                   'member', '{creates_record}',          false, 'Create a new team in the organization'),
  ('teams.roles.add',          'teams',  'Add Team Roles',           'Add roles to an existing team',                                 'member', '{updates_record}',          true,  'Add roles to a team'),
  ('teams.kpis.add',           'teams',  'Add Team KPIs',            'Add KPIs to an existing team',                                  'member', '{updates_record}',          true,  'Add KPI metrics to a team'),
  ('teams.tools.add',          'teams',  'Add Team Tools',           'Add tools to an existing team',                                 'member', '{updates_record}',          true,  'Add tools/software to a team'),
  ('teams.description.update', 'teams',  'Update Team Description',  'Update a team description',                                     'member', '{updates_record}',          true,  'Update the description of a team'),
  ('teams.roles.delete',       'teams',  'Delete Team Roles',        'Remove roles from a team',                                      'member', '{deletes_data}',            true,  'Remove roles from a team'),
  ('teams.kpis.delete',        'teams',  'Delete Team KPIs',         'Remove KPIs from a team',                                       'member', '{deletes_data}',            true,  'Remove KPIs from a team'),
  ('teams.tools.delete',       'teams',  'Delete Team Tools',        'Remove tools from a team',                                      'member', '{deletes_data}',            true,  'Remove tools from a team'),

  -- Goal tools
  ('goals.create',             'goals',  'Create Goal',              'Create a new strategic goal',                                   'member', '{creates_record}',          false, 'Create a new organizational goal'),
  ('goals.sub_goals.add',      'goals',  'Add Sub-Goals',            'Add sub-goals to an existing goal',                             'member', '{creates_record}',          true,  'Add sub-goals under a parent goal'),
  ('goals.status.update',      'goals',  'Update Goal Status',       'Change the status of a goal',                                   'member', '{updates_record}',          true,  'Update the status of a goal'),
  ('goals.delete',             'goals',  'Delete Goal',              'Delete a goal and its sub-goals',                               'member', '{deletes_data}',            false, 'Delete a goal'),

  -- Pain point tools
  ('pain_points.create',        'pain_points', 'Create Pain Point',        'Record a business pain point',                            'member', '{creates_record}',          false, 'Create a new pain point'),
  ('pain_points.status.update', 'pain_points', 'Update Pain Point Status', 'Update the status of a pain point',                       'member', '{updates_record}',          true,  'Update the status of a pain point'),
  ('pain_points.delete',        'pain_points', 'Delete Pain Point',        'Delete a pain point',                                     'member', '{deletes_data}',            false, 'Delete a pain point'),

  -- Library tools
  ('library.item.create',     'library', 'Create Library Item',      'Create a library item (template, document, etc.)',              'member', '{creates_record}',          false, 'Create a new library item'),

  -- Organization tools
  ('org.update',               'org',    'Update Organization',      'Update organization profile details',                           'admin',  '{updates_record}',          true,  'Update organization settings'),
  ('org.member.invite',        'org',    'Invite Member',            'Invite a new member to the organization',                       'admin',  '{sends_email,creates_record}', false, 'Invite someone to join the organization'),
  ('org.member.list',          'org',    'List Members',             'List organization members',                                     'member', '{}',                        false, 'List all organization members'),
  ('org.member.role.update',   'org',    'Update Member Role',       'Change a member role',                                          'admin',  '{updates_record}',          true,  'Change a member role in the organization'),
  ('org.member.remove',        'org',    'Remove Member',            'Remove a member from the organization',                         'admin',  '{deletes_data}',            false, 'Remove a member from the organization'),
  ('org.department.create',    'org',    'Create Department',        'Create a new department',                                       'admin',  '{creates_record}',          false, 'Create a new department'),
  ('org.info.list',            'org',    'List Org Info',            'Get organization information',                                  'member', '{}',                        false, 'Get organization information'),

  -- CRM tools
  ('crm.contact.create',      'crm',    'Create Contact',           'Create a new CRM contact',                                      'member', '{creates_record}',          false, 'Create a new contact in the CRM'),
  ('crm.contact.update',      'crm',    'Update Contact',           'Update an existing CRM contact',                                'member', '{updates_record}',          true,  'Update contact details'),
  ('crm.company.create',      'crm',    'Create Company',           'Create a new CRM company',                                      'member', '{creates_record}',          false, 'Create a new company in the CRM'),
  ('crm.deal.create',         'crm',    'Create Deal',              'Create a new CRM deal',                                         'member', '{creates_record}',          false, 'Create a new deal in the CRM'),
  ('crm.deal.stage.update',   'crm',    'Update Deal Stage',        'Move a deal to a different pipeline stage',                     'member', '{updates_record}',          true,  'Update the pipeline stage of a deal'),
  ('crm.activity.log',        'crm',    'Log Activity',             'Log a CRM activity (call, email, meeting, note)',               'member', '{creates_record}',          false, 'Log an activity for a CRM record'),
  ('crm.search',              'crm',    'Search CRM',               'Search across CRM contacts, companies, and deals',              'member', '{}',                        false, 'Search the CRM'),
  ('crm.summary.get',         'crm',    'Get CRM Summary',          'Get summary statistics of the CRM',                             'member', '{}',                        false, 'Get a summary of CRM data'),
  ('crm.product.create',      'crm',    'Create Product',           'Create a new product in the catalog',                           'member', '{creates_record}',          false, 'Create a new product'),
  ('crm.deal.line_item.add',  'crm',    'Add Deal Line Item',       'Add a product line item to a deal',                             'member', '{creates_record}',          true,  'Add a line item to a deal'),
  ('crm.company.asset.add',   'crm',    'Add Company Asset',        'Add an asset to a company',                                     'member', '{creates_record}',          true,  'Add an asset to a company'),
  ('crm.data.import',         'crm',    'Import CSV Data',          'Import data from CSV into the CRM',                             'admin',  '{creates_record,bulk_operation}', false, 'Import CSV data into the CRM'),
  ('crm.report.create',       'crm',    'Create Report',            'Create a new CRM report',                                       'member', '{creates_record}',          false, 'Create a new CRM report'),
  ('crm.report.update',       'crm',    'Update Report',            'Update an existing CRM report',                                 'member', '{updates_record}',          true,  'Update a CRM report'),

  -- Tool catalog tools
  ('tools.catalog.search',    'tools',  'Search Tool Catalog',      'Search the SaaS tool catalog',                                  'member', '{}',                        false, 'Search for tools in the catalog'),
  ('tools.stack.add',         'tools',  'Add Stack Tool',           'Add a tool to the organization tech stack',                     'member', '{creates_record}',          true,  'Add a tool to the tech stack'),
  ('tools.stack.remove',      'tools',  'Remove Stack Tool',        'Remove a tool from the tech stack',                             'member', '{deletes_data}',            true,  'Remove a tool from the tech stack'),
  ('tools.compare',           'tools',  'Compare Tools',            'Compare multiple SaaS tools',                                   'member', '{}',                        false, 'Compare tools side by side'),

  -- Project / Canvas tools
  ('projects.create',         'projects', 'Create Project',         'Create a new project',                                          'member', '{creates_record}',          false, 'Create a new project'),
  ('projects.canvas.update',  'projects', 'Update Canvas',          'Update a project canvas content',                               'member', '{updates_record}',          true,  'Update the canvas of a project'),

  -- Workflow tools
  ('workflows.generate',              'workflows', 'Generate Workflow',          'Generate a workflow from description',              'member', '{creates_record}',          false, 'Generate a workflow from a description'),
  ('workflows.generate_from_document','workflows', 'Generate Workflow from Doc', 'Generate a workflow from an uploaded document',     'member', '{creates_record}',          false, 'Generate a workflow from a document')

ON CONFLICT (action_name) DO NOTHING;

-- ── 6. Helper: Map old tool names to new action names ───────
-- This lookup is used by action-registry.ts at runtime.
-- Not a table — just a comment for reference:
--
-- create_team              → teams.create
-- add_team_roles           → teams.roles.add
-- add_team_kpis            → teams.kpis.add
-- add_team_tools           → teams.tools.add
-- update_team_description  → teams.description.update
-- delete_team_roles        → teams.roles.delete
-- delete_team_kpis         → teams.kpis.delete
-- delete_team_tools        → teams.tools.delete
-- create_goal              → goals.create
-- add_sub_goals            → goals.sub_goals.add
-- update_goal_status       → goals.status.update
-- delete_goal              → goals.delete
-- create_pain_point        → pain_points.create
-- update_pain_point_status → pain_points.status.update
-- delete_pain_point        → pain_points.delete
-- create_library_item      → library.item.create
-- update_organization      → org.update
-- invite_member            → org.member.invite
-- list_members             → org.member.list
-- update_member_role       → org.member.role.update
-- remove_member            → org.member.remove
-- create_department        → org.department.create
-- list_org_info            → org.info.list
-- create_contact           → crm.contact.create
-- update_contact           → crm.contact.update
-- create_company           → crm.company.create
-- create_deal              → crm.deal.create
-- update_deal_stage        → crm.deal.stage.update
-- log_activity             → crm.activity.log
-- search_crm               → crm.search
-- get_crm_summary          → crm.summary.get
-- create_product           → crm.product.create
-- add_deal_line_item       → crm.deal.line_item.add
-- add_company_asset        → crm.company.asset.add
-- import_csv_data          → crm.data.import
-- create_report            → crm.report.create
-- update_report            → crm.report.update
-- search_tool_catalog      → tools.catalog.search
-- add_stack_tool           → tools.stack.add
-- remove_stack_tool        → tools.stack.remove
-- compare_tools            → tools.compare
-- create_project           → projects.create
-- update_canvas            → projects.canvas.update
-- generate_workflow        → workflows.generate
-- generate_workflow_from_document → workflows.generate_from_document
