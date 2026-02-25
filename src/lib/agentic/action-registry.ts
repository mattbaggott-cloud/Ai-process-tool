/**
 * Action Registry — maps tool names to formalized action definitions.
 * Loads from `action_registry` table and caches in memory.
 *
 * The registry bridges the old tool-executor tool names (e.g. "create_contact")
 * to the new namespaced action names (e.g. "crm.contact.create") used by the
 * action framework for policy evaluation and audit trails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ── */

export interface ActionDefinition {
  id: string;
  action_name: string;
  category: string;
  display_name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  min_role: string;
  requires_approval: boolean;
  side_effects: string[];
  is_reversible: boolean;
  ai_description: string | null;
  is_active: boolean;
}

/* ── Tool Name → Action Name Mapping ── */

const TOOL_TO_ACTION: Record<string, string> = {
  // Teams
  create_team: "teams.create",
  add_team_roles: "teams.roles.add",
  add_team_kpis: "teams.kpis.add",
  add_team_tools: "teams.tools.add",
  update_team_description: "teams.description.update",
  delete_team_roles: "teams.roles.delete",
  delete_team_kpis: "teams.kpis.delete",
  delete_team_tools: "teams.tools.delete",

  // Goals
  create_goal: "goals.create",
  add_sub_goals: "goals.sub_goals.add",
  update_goal_status: "goals.status.update",
  delete_goal: "goals.delete",

  // Pain points
  create_pain_point: "pain_points.create",
  update_pain_point_status: "pain_points.status.update",
  delete_pain_point: "pain_points.delete",

  // Library
  create_library_item: "library.item.create",

  // Organization
  update_organization: "org.update",
  invite_member: "org.member.invite",
  list_members: "org.member.list",
  update_member_role: "org.member.role.update",
  remove_member: "org.member.remove",
  create_department: "org.department.create",
  list_org_info: "org.info.list",

  // CRM
  create_contact: "crm.contact.create",
  update_contact: "crm.contact.update",
  create_company: "crm.company.create",
  create_deal: "crm.deal.create",
  update_deal_stage: "crm.deal.stage.update",
  log_activity: "crm.activity.log",
  search_crm: "crm.search",
  get_crm_summary: "crm.summary.get",
  create_product: "crm.product.create",
  add_deal_line_item: "crm.deal.line_item.add",
  add_company_asset: "crm.company.asset.add",
  import_data: "data.import",

  // Tool catalog
  search_tool_catalog: "tools.catalog.search",
  add_stack_tool: "tools.stack.add",
  remove_stack_tool: "tools.stack.remove",
  compare_tools: "tools.compare",

  // Projects
  create_project: "projects.create",
  update_canvas: "projects.canvas.update",

  // Workflows
  generate_workflow: "workflows.generate",
  generate_workflow_from_document: "workflows.generate_from_document",

  // Campaign Engine
  create_campaign: "email.campaign.create",
  generate_campaign: "email.campaign.create",          // legacy alias
  plan_campaign_strategy: "email.campaign.create",     // legacy alias
  create_sequence: "email.campaign.create",            // legacy alias
  send_campaign: "email.campaign.send",
  get_campaign_status: "email.campaign.status",
};

/* ── In-Memory Cache ── */

let cachedDefinitions: Map<string, ActionDefinition> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ── Public API ── */

/**
 * Resolve a tool name (from tool-executor.ts) to a namespaced action name.
 * Returns the tool name as-is if no mapping exists (forward compatible).
 */
export function resolveActionName(toolName: string): string {
  return TOOL_TO_ACTION[toolName] ?? toolName;
}

/**
 * Get the action definition for a given action name.
 * Loads from DB and caches in memory.
 */
export async function getActionDefinition(
  supabase: SupabaseClient,
  actionName: string
): Promise<ActionDefinition | null> {
  const defs = await loadDefinitions(supabase);
  return defs.get(actionName) ?? null;
}

/**
 * Get all active action definitions (cached).
 */
export async function getAllActions(
  supabase: SupabaseClient
): Promise<ActionDefinition[]> {
  const defs = await loadDefinitions(supabase);
  return Array.from(defs.values());
}

/**
 * Check if an action has a specific side effect.
 */
export function hasSideEffect(
  action: ActionDefinition,
  effect: string
): boolean {
  return action.side_effects.includes(effect);
}

/**
 * Check if an action is read-only (no side effects).
 */
export function isReadOnly(action: ActionDefinition): boolean {
  return action.side_effects.length === 0;
}

/* ── Internal ── */

async function loadDefinitions(
  supabase: SupabaseClient
): Promise<Map<string, ActionDefinition>> {
  // Return cache if fresh
  if (cachedDefinitions && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDefinitions;
  }

  try {
    const { data, error } = await supabase
      .from("action_registry")
      .select("*")
      .eq("is_active", true);

    if (error) {
      console.error("[ActionRegistry] Load failed:", error.message);
      // Return stale cache if available, empty map otherwise
      return cachedDefinitions ?? new Map();
    }

    const map = new Map<string, ActionDefinition>();
    for (const row of data ?? []) {
      map.set(row.action_name, row as ActionDefinition);
    }

    cachedDefinitions = map;
    cacheTimestamp = Date.now();
    return map;
  } catch (err) {
    console.error("[ActionRegistry] Load error:", err);
    return cachedDefinitions ?? new Map();
  }
}
