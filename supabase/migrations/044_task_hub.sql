-- ══════════════════════════════════════════════════════════
-- Migration 044: Unified Task Hub
-- General-purpose tasks table for reminders, to-dos,
-- follow-ups, project tasks, and action items.
-- Complements campaign_tasks (untouched).
-- ══════════════════════════════════════════════════════════

-- ── Tasks table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  task_type       TEXT NOT NULL DEFAULT 'todo'
                  CHECK (task_type IN ('todo','reminder','follow_up','project_task','action_item')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low','medium','high','urgent')),
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  deal_id         UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  assigned_to     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','cancelled')),
  due_at          TIMESTAMPTZ,
  remind_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_org
  ON tasks(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status
  ON tasks(assigned_to, status)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_tasks_due
  ON tasks(org_id, due_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON tasks(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_remind
  ON tasks(remind_at)
  WHERE remind_at IS NOT NULL AND status = 'pending';

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_org_access ON tasks
  FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- ── Updated_at trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_tasks_updated_at();
