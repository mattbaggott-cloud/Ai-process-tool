-- ============================================================
-- Migration 013: Workflow Executions Table
-- ============================================================
-- Supports step-through execution of workflows.
-- A user starts a "run" of a workflow and steps through nodes,
-- marking each as complete. completed_nodes stores a JSONB array
-- of { nodeId, nodeTitle, completedBy, completedAt, notes, branchChosen }.
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_by      UUID NOT NULL REFERENCES auth.users(id),
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  current_node_id TEXT,
  completed_nodes JSONB NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add org_id column for multi-tenancy RLS
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Org members can view workflow executions"
  ON workflow_executions FOR SELECT
  USING (user_is_org_member(org_id));

CREATE POLICY "Org users can create workflow executions"
  ON workflow_executions FOR INSERT
  WITH CHECK (user_has_org_role(org_id, 'user'));

CREATE POLICY "Org users can update workflow executions"
  ON workflow_executions FOR UPDATE
  USING (user_has_org_role(org_id, 'user'));

CREATE POLICY "Org admins can delete workflow executions"
  ON workflow_executions FOR DELETE
  USING (user_has_org_role(org_id, 'admin'));

-- Indexes
CREATE INDEX idx_workflow_executions_org ON workflow_executions(org_id);
CREATE INDEX idx_workflow_executions_project ON workflow_executions(project_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status) WHERE status = 'in_progress';
