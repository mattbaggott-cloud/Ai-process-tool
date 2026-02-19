import { SupabaseClient } from "@supabase/supabase-js";
import { embedInBackground, reembedInBackground, deleteChunksInBackground } from "@/lib/embeddings/index";
import { hasMinRole } from "@/lib/org";
import type { OrgRole } from "@/lib/types/database";
import { emitToolEvent } from "@/lib/agentic/event-emitter";
import { syncRecordToGraphInBackground } from "@/lib/agentic/graph-sync";

/* ── Types ─────────────────────────────────────────────── */

interface ToolResult {
  success: boolean;
  message: string;
}

/* ── Main executor ─────────────────────────────────────── */

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole = "viewer",
  sessionId?: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "create_team":
        return await handleCreateTeam(input, supabase, userId, orgId);
      case "add_team_roles":
        return await handleAddTeamRoles(input, supabase, orgId);
      case "add_team_kpis":
        return await handleAddTeamKpis(input, supabase, orgId);
      case "add_team_tools":
        return await handleAddTeamTools(input, supabase, userId, orgId);
      case "update_team_description":
        return await handleUpdateTeamDescription(input, supabase);
      case "create_goal":
        return await handleCreateGoal(input, supabase, userId, orgId);
      case "add_sub_goals":
        return await handleAddSubGoals(input, supabase, userId, orgId);
      case "update_goal_status":
        return await handleUpdateGoalStatus(input, supabase);
      case "create_library_item":
        return await handleCreateLibraryItem(input, supabase, userId, orgId);
      case "delete_team_roles":
        return await handleDeleteTeamRoles(input, supabase);
      case "delete_team_kpis":
        return await handleDeleteTeamKpis(input, supabase);
      case "delete_team_tools":
        return await handleDeleteTeamTools(input, supabase);
      case "delete_goal":
        return await handleDeleteGoal(input, supabase);
      case "create_pain_point":
        return await handleCreatePainPoint(input, supabase, userId, orgId);
      case "update_pain_point_status":
        return await handleUpdatePainPointStatus(input, supabase);
      case "delete_pain_point":
        return await handleDeletePainPoint(input, supabase);
      case "update_organization":
        return await handleUpdateOrganization(input, supabase, userId, orgId);
      case "search_tool_catalog":
        return await handleSearchToolCatalog(input, supabase);
      case "add_stack_tool":
        return await handleAddStackTool(input, supabase, userId, orgId);
      case "remove_stack_tool":
        return await handleRemoveStackTool(input, supabase);
      case "compare_tools":
        return await handleCompareTools(input, supabase);
      case "create_project":
        return await handleCreateProject(input, supabase, userId, orgId);
      case "update_canvas":
        return await handleUpdateCanvas(input, supabase);
      case "generate_workflow":
        return await handleGenerateWorkflow(input, supabase, userRole);
      case "generate_workflow_from_document":
        return await handleGenerateWorkflowFromDocument(input, supabase, userRole);
      /* CRM tools */
      case "create_contact":
        return await handleCreateContact(input, supabase, userId, orgId);
      case "update_contact":
        return await handleUpdateContact(input, supabase);
      case "create_company":
        return await handleCreateCompany(input, supabase, userId, orgId);
      case "create_deal":
        return await handleCreateDeal(input, supabase, userId, orgId);
      case "update_deal_stage":
        return await handleUpdateDealStage(input, supabase, orgId);
      case "log_activity":
        return await handleLogActivity(input, supabase, userId, orgId);
      case "search_crm":
        return await handleSearchCrm(input, supabase);
      case "get_crm_summary":
        return await handleGetCrmSummary(input, supabase);
      case "create_product":
        return await handleCreateProduct(input, supabase, userId, orgId);
      case "add_deal_line_item":
        return await handleAddDealLineItem(input, supabase, userId, orgId);
      case "add_company_asset":
        return await handleAddCompanyAsset(input, supabase, userId, orgId);
      case "import_csv_data":
        return await handleImportCsvData(input, supabase, userId, orgId);
      case "create_report":
        return await handleCreateReport(input, supabase, userId, orgId);
      case "update_report":
        return await handleUpdateReport(input, supabase, userId, orgId);
      /* E-Commerce tools */
      case "query_ecommerce":
        return await handleQueryEcommerce(input, supabase, orgId);
      /* Org management tools */
      case "invite_member":
        return await handleInviteMember(input, supabase, userId, orgId, userRole);
      case "list_members":
        return await handleListMembers(input, supabase, userId, orgId);
      case "update_member_role":
        return await handleUpdateMemberRole(input, supabase, userId, orgId, userRole);
      case "remove_member":
        return await handleRemoveMember(input, supabase, userId, orgId, userRole);
      case "create_department":
        return await handleCreateDepartmentTool(input, supabase, orgId, userRole);
      case "list_org_info":
        return await handleListOrgInfo(input, supabase, orgId);
      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Emit failure event
    emitToolEvent(supabase, {
      orgId, userId, toolName, success: false, sessionId,
      output: { message: msg },
    });
    return { success: false, message: `Tool execution failed: ${msg}` };
  }
}

/**
 * Wrapper that calls executeTool and emits events + syncs graph.
 * This is the entry point called from route.ts.
 */
export async function executeToolWithGraph(
  toolName: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole = "viewer",
  sessionId?: string
): Promise<ToolResult> {
  const result = await executeTool(toolName, input, supabase, userId, orgId, userRole, sessionId);

  // Fire-and-forget: emit event + sync graph
  const entityInfo = inferEntityFromTool(toolName, input, result);
  emitToolEvent(supabase, {
    orgId,
    userId,
    toolName,
    success: result.success,
    entityType: entityInfo?.entityType,
    entityId: entityInfo?.entityId,
    input,
    output: { message: result.message },
    sessionId,
  });

  // If the tool created/updated an entity, sync to graph
  if (result.success && entityInfo?.entityType && entityInfo?.entityId) {
    syncRecordToGraphInBackground(
      supabase,
      orgId,
      entityInfo.entityType,
      entityInfo.entityId,
      { ...input, id: entityInfo.entityId },
      userId
    );
  }

  return result;
}

/**
 * Infer entity type and id from tool name + result.
 * Used to link events and graph nodes to the affected entity.
 */
function inferEntityFromTool(
  toolName: string,
  input: Record<string, unknown>,
  result: ToolResult
): { entityType: string; entityId: string } | null {
  // Map tool names to entity types
  const TOOL_ENTITY_MAP: Record<string, string> = {
    create_team: "teams",
    update_team_description: "teams",
    create_goal: "goals",
    add_sub_goals: "sub_goals",
    update_goal_status: "goals",
    delete_goal: "goals",
    create_pain_point: "pain_points",
    update_pain_point_status: "pain_points",
    delete_pain_point: "pain_points",
    create_library_item: "library_items",
    create_project: "projects",
    update_canvas: "projects",
    create_contact: "crm_contacts",
    update_contact: "crm_contacts",
    create_company: "crm_companies",
    create_deal: "crm_deals",
    update_deal_stage: "crm_deals",
    log_activity: "crm_activities",
    create_product: "crm_products",
    update_organization: "org_profiles",
    invite_member: "org_invites",
    update_member_role: "org_members",
    remove_member: "org_members",
    create_department: "org_departments",
    create_report: "crm_reports",
    update_report: "crm_reports",
  };

  const entityType = TOOL_ENTITY_MAP[toolName];
  if (!entityType) return null;

  // Try to extract entity id from input or result message
  const entityId =
    (input.id as string) ||
    (input.contact_id as string) ||
    (input.company_id as string) ||
    (input.deal_id as string) ||
    (input.goal_id as string) ||
    extractIdFromResult(result.message);

  if (!entityId) return null;
  return { entityType, entityId };
}

/** Try to extract a UUID from a result message */
function extractIdFromResult(message: string): string | null {
  const uuidMatch = message.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return uuidMatch ? uuidMatch[0] : null;
}

/* ── Helper: resolve team name → id ────────────────────── */

async function resolveTeamId(
  teamName: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase
    .from("teams")
    .select("id")
    .ilike("name", teamName)
    .single();
  return data?.id ?? null;
}

/* ── Helper: resolve goal name → id ────────────────────── */

async function resolveGoalId(
  goalName: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase
    .from("goals")
    .select("id")
    .ilike("name", goalName)
    .single();
  return data?.id ?? null;
}

/* ══════════════════════════════════════════════════════════
   TEAM HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleCreateTeam(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Team name is required" };

  const description = (input.description as string) ?? "";
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const { data, error } = await supabase
    .from("teams")
    .insert({ user_id: userId, org_id: orgId, slug, name, description })
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create team: ${error.message}` };
  return { success: true, message: `Created team "${data.name}" with slug "${data.slug}"` };
}

async function handleAddTeamRoles(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const roles = input.roles as Array<{ name: string; description?: string; headcount?: number }>;

  if (!teamName || !roles?.length) {
    return { success: false, message: "team_name and roles are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* Check for existing roles on this team */
  const { data: existingRoles } = await supabase
    .from("team_roles")
    .select("id, name")
    .eq("team_id", teamId);

  const existingMap = new Map(
    (existingRoles ?? []).map((r) => [r.name.toLowerCase(), r.id])
  );

  const toInsert: typeof roles = [];
  const toUpdate: Array<{ id: string; name: string; description: string; headcount: number }> = [];

  for (const r of roles) {
    const existingId = existingMap.get(r.name.toLowerCase());
    if (existingId) {
      toUpdate.push({ id: existingId, name: r.name, description: r.description ?? "", headcount: r.headcount ?? 1 });
    } else {
      toInsert.push(r);
    }
  }

  /* Update existing roles */
  for (const u of toUpdate) {
    await supabase.from("team_roles").update({ name: u.name, description: u.description, headcount: u.headcount }).eq("id", u.id);
  }

  /* Insert new roles */
  if (toInsert.length > 0) {
    const rows = toInsert.map((r) => ({
      team_id: teamId,
      org_id: orgId,
      name: r.name,
      description: r.description ?? "",
      headcount: r.headcount ?? 1,
    }));
    const { error } = await supabase.from("team_roles").insert(rows);
    if (error) return { success: false, message: `Failed to add roles: ${error.message}` };
  }

  const parts: string[] = [];
  if (toInsert.length > 0) parts.push(`added ${toInsert.length} new role(s): ${toInsert.map((r) => r.name).join(", ")}`);
  if (toUpdate.length > 0) parts.push(`updated ${toUpdate.length} existing role(s): ${toUpdate.map((r) => r.name).join(", ")}`);
  return { success: true, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleAddTeamKpis(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const kpis = input.kpis as Array<{
    name: string;
    current_value?: number;
    target_value?: number;
    period?: string;
  }>;

  if (!teamName || !kpis?.length) {
    return { success: false, message: "team_name and kpis are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* Check for existing KPIs on this team */
  const { data: existingKpis } = await supabase
    .from("team_kpis")
    .select("id, name")
    .eq("team_id", teamId);

  const existingMap = new Map(
    (existingKpis ?? []).map((k) => [k.name.toLowerCase(), k.id])
  );

  const toInsert: typeof kpis = [];
  const toUpdate: Array<{ id: string; name: string; current_value: number | null; target_value: number | null; period: string }> = [];

  for (const k of kpis) {
    const existingId = existingMap.get(k.name.toLowerCase());
    if (existingId) {
      toUpdate.push({ id: existingId, name: k.name, current_value: k.current_value ?? null, target_value: k.target_value ?? null, period: k.period ?? "Month" });
    } else {
      toInsert.push(k);
    }
  }

  for (const u of toUpdate) {
    await supabase.from("team_kpis").update({ name: u.name, current_value: u.current_value, target_value: u.target_value, period: u.period }).eq("id", u.id);
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((k) => ({
      team_id: teamId,
      org_id: orgId,
      name: k.name,
      current_value: k.current_value ?? null,
      target_value: k.target_value ?? null,
      period: k.period ?? "Month",
    }));
    const { error } = await supabase.from("team_kpis").insert(rows);
    if (error) return { success: false, message: `Failed to add KPIs: ${error.message}` };
  }

  const parts: string[] = [];
  if (toInsert.length > 0) parts.push(`added ${toInsert.length} new KPI(s): ${toInsert.map((k) => k.name).join(", ")}`);
  if (toUpdate.length > 0) parts.push(`updated ${toUpdate.length} existing KPI(s): ${toUpdate.map((k) => k.name).join(", ")}`);
  return { success: true, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleAddTeamTools(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const tools = input.tools as Array<{ name: string; purpose?: string }>;

  if (!teamName || !tools?.length) {
    return { success: false, message: "team_name and tools are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* Check for existing tools on this team */
  const { data: existingTools } = await supabase
    .from("team_tools")
    .select("id, name")
    .eq("team_id", teamId);

  const existingMap = new Map(
    (existingTools ?? []).map((t) => [t.name.toLowerCase(), t.id])
  );

  const toInsert: typeof tools = [];
  const toUpdate: Array<{ id: string; name: string; purpose: string }> = [];

  for (const t of tools) {
    const existingId = existingMap.get(t.name.toLowerCase());
    if (existingId) {
      toUpdate.push({ id: existingId, name: t.name, purpose: t.purpose ?? "" });
    } else {
      toInsert.push(t);
    }
  }

  for (const u of toUpdate) {
    await supabase.from("team_tools").update({ name: u.name, purpose: u.purpose }).eq("id", u.id);
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((t) => ({
      team_id: teamId,
      org_id: orgId,
      name: t.name,
      purpose: t.purpose ?? "",
    }));
    const { error } = await supabase.from("team_tools").insert(rows);
    if (error) return { success: false, message: `Failed to add tools: ${error.message}` };
  }

  /* Sync all tools (new + updated) to user_stack_tools */
  const allTools = [...toInsert, ...toUpdate];
  for (const t of allTools) {
    const { data: stackExisting } = await supabase
      .from("user_stack_tools")
      .select("id, teams")
      .ilike("name", t.name)
      .limit(1);

    if (stackExisting && stackExisting.length > 0) {
      /* Already in stack — add this team if not tagged */
      const currentTeams: string[] = stackExisting[0].teams ?? [];
      if (!currentTeams.some((tn) => tn.toLowerCase() === teamName.toLowerCase())) {
        await supabase
          .from("user_stack_tools")
          .update({ teams: [...currentTeams, teamName] })
          .eq("id", stackExisting[0].id);
      }
    } else {
      /* Not in stack — create entry */
      await supabase.from("user_stack_tools").insert({
        user_id: userId,
        org_id: orgId,
        name: t.name,
        description: t.purpose ?? "",
        category: "",
        teams: [teamName],
        team_usage: t.purpose ? { [teamName]: t.purpose } : {},
        status: "Active",
      });
    }
  }

  const parts: string[] = [];
  if (toInsert.length > 0) parts.push(`added ${toInsert.length} new tool(s): ${toInsert.map((t) => t.name).join(", ")}`);
  if (toUpdate.length > 0) parts.push(`updated ${toUpdate.length} existing tool(s): ${toUpdate.map((t) => t.name).join(", ")}`);
  return { success: true, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleUpdateTeamDescription(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const description = input.description as string;

  if (!teamName || !description) {
    return { success: false, message: "team_name and description are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  const { error } = await supabase
    .from("teams")
    .update({ description })
    .eq("id", teamId);

  if (error) return { success: false, message: `Failed to update description: ${error.message}` };
  return { success: true, message: `Updated description for "${teamName}"` };
}

/* ══════════════════════════════════════════════════════════
   GOAL HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleCreateGoal(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Goal name is required" };

  const row = {
    user_id: userId,
    org_id: orgId,
    name,
    description: (input.description as string) ?? "",
    status: (input.status as string) ?? "Backlog",
    owner: (input.owner as string) ?? "",
    teams: (input.teams as string[]) ?? [],
    start_date: (input.start_date as string) ?? null,
    end_date: (input.end_date as string) ?? null,
    metric: (input.metric as string) ?? "",
    metric_target: (input.metric_target as string) ?? "",
  };

  const { data, error } = await supabase
    .from("goals")
    .insert(row)
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create goal: ${error.message}` };

  // Embed the new goal (fire-and-forget)
  embedInBackground(supabase, userId, "goals", data.id, data);

  return { success: true, message: `Created goal "${data.name}" with status "${data.status}"` };
}

async function handleAddSubGoals(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const goalName = input.goal_name as string;
  const subGoals = input.sub_goals as Array<{
    name: string;
    description?: string;
    status?: string;
    owner?: string;
    end_date?: string;
  }>;

  if (!goalName || !subGoals?.length) {
    return { success: false, message: "goal_name and sub_goals are required" };
  }

  const goalId = await resolveGoalId(goalName, supabase);
  if (!goalId) return { success: false, message: `Goal "${goalName}" not found` };

  const rows = subGoals.map((s) => ({
    goal_id: goalId,
    user_id: userId,
    org_id: orgId,
    name: s.name,
    description: s.description ?? "",
    status: s.status ?? "Backlog",
    owner: s.owner ?? "",
    end_date: s.end_date ?? null,
  }));

  const { data: insertedSubs, error } = await supabase.from("sub_goals").insert(rows).select();
  if (error) return { success: false, message: `Failed to add sub-goals: ${error.message}` };

  // Embed each sub-goal (fire-and-forget)
  for (const sub of insertedSubs ?? []) {
    embedInBackground(supabase, userId, "sub_goals", sub.id, sub);
  }

  return { success: true, message: `Added ${subGoals.length} sub-goal(s) to "${goalName}": ${subGoals.map((s) => s.name).join(", ")}` };
}

async function handleUpdateGoalStatus(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const goalName = input.goal_name as string;
  const subGoalName = input.sub_goal_name as string | undefined;
  const status = input.status as string;

  if (!goalName || !status) {
    return { success: false, message: "goal_name and status are required" };
  }

  if (subGoalName) {
    /* Update a sub-goal */
    const goalId = await resolveGoalId(goalName, supabase);
    if (!goalId) return { success: false, message: `Goal "${goalName}" not found` };

    const { data: subGoal } = await supabase
      .from("sub_goals")
      .select("id")
      .eq("goal_id", goalId)
      .ilike("name", subGoalName)
      .single();

    if (!subGoal) {
      return { success: false, message: `Sub-goal "${subGoalName}" not found under "${goalName}"` };
    }

    const { error } = await supabase
      .from("sub_goals")
      .update({ status })
      .eq("id", subGoal.id);

    if (error) return { success: false, message: `Failed to update sub-goal: ${error.message}` };

    // Re-embed the sub-goal with updated status (fire-and-forget)
    const { data: updatedSub } = await supabase.from("sub_goals").select("*").eq("id", subGoal.id).single();
    if (updatedSub) reembedInBackground(supabase, updatedSub.user_id ?? "", "sub_goals", subGoal.id, updatedSub);

    return { success: true, message: `Updated sub-goal "${subGoalName}" to "${status}"` };
  } else {
    /* Update the parent goal */
    const goalId = await resolveGoalId(goalName, supabase);
    if (!goalId) return { success: false, message: `Goal "${goalName}" not found` };

    const { error } = await supabase
      .from("goals")
      .update({ status })
      .eq("id", goalId);

    if (error) return { success: false, message: `Failed to update goal: ${error.message}` };

    // Re-embed the goal with updated status (fire-and-forget)
    const { data: updatedGoal } = await supabase.from("goals").select("*").eq("id", goalId).single();
    if (updatedGoal) reembedInBackground(supabase, updatedGoal.user_id, "goals", goalId, updatedGoal);

    return { success: true, message: `Updated goal "${goalName}" to "${status}"` };
  }
}

/* ══════════════════════════════════════════════════════════
   PAIN POINT HANDLERS
   ══════════════════════════════════════════════════════════ */

async function resolvePainPointId(
  name: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase
    .from("pain_points")
    .select("id")
    .ilike("name", name)
    .single();
  return data?.id ?? null;
}

async function handleCreatePainPoint(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Pain point name is required" };

  let linkedGoalId: string | null = null;
  const linkedGoalName = input.linked_goal_name as string | undefined;
  if (linkedGoalName) {
    linkedGoalId = await resolveGoalId(linkedGoalName, supabase);
    if (!linkedGoalId) {
      return { success: false, message: `Linked goal "${linkedGoalName}" not found` };
    }
  }

  const row = {
    user_id: userId,
    org_id: orgId,
    name,
    description: (input.description as string) ?? "",
    severity: (input.severity as string) ?? "Medium",
    status: (input.status as string) ?? "Backlog",
    owner: (input.owner as string) ?? "",
    teams: (input.teams as string[]) ?? [],
    impact_metric: (input.impact_metric as string) ?? "",
    linked_goal_id: linkedGoalId,
  };

  const { data, error } = await supabase
    .from("pain_points")
    .insert(row)
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create pain point: ${error.message}` };

  // Embed the new pain point (fire-and-forget)
  embedInBackground(supabase, userId, "pain_points", data.id, data);

  const linked = linkedGoalName ? ` (linked to "${linkedGoalName}")` : "";
  return { success: true, message: `Created pain point "${data.name}" [${data.severity}]${linked}` };
}

async function handleUpdatePainPointStatus(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const ppName = input.pain_point_name as string;
  if (!ppName) return { success: false, message: "pain_point_name is required" };

  const ppId = await resolvePainPointId(ppName, supabase);
  if (!ppId) return { success: false, message: `Pain point "${ppName}" not found` };

  const updates: Record<string, unknown> = {};
  if (input.status) updates.status = input.status;
  if (input.severity) updates.severity = input.severity;

  if (Object.keys(updates).length === 0) {
    return { success: false, message: "Provide at least status or severity to update" };
  }

  const { error } = await supabase
    .from("pain_points")
    .update(updates)
    .eq("id", ppId);

  if (error) return { success: false, message: `Failed to update pain point: ${error.message}` };

  // Re-embed the pain point with updated fields (fire-and-forget)
  const { data: updatedPP } = await supabase.from("pain_points").select("*").eq("id", ppId).single();
  if (updatedPP) reembedInBackground(supabase, updatedPP.user_id, "pain_points", ppId, updatedPP);

  const fields = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(", ");
  return { success: true, message: `Updated pain point "${ppName}" — ${fields}` };
}

async function handleDeletePainPoint(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const ppName = input.pain_point_name as string;
  if (!ppName) return { success: false, message: "pain_point_name is required" };

  const ppId = await resolvePainPointId(ppName, supabase);
  if (!ppId) return { success: false, message: `Pain point "${ppName}" not found` };

  const { error } = await supabase.from("pain_points").delete().eq("id", ppId);
  if (error) return { success: false, message: `Failed to delete pain point: ${error.message}` };

  // Delete chunks for the deleted pain point (fire-and-forget)
  deleteChunksInBackground(supabase, "pain_points", ppId);

  return { success: true, message: `Deleted pain point "${ppName}"` };
}

/* ══════════════════════════════════════════════════════════
   LIBRARY HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleCreateLibraryItem(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const title = input.title as string;
  const content = input.content as string;

  if (!title || !content) {
    return { success: false, message: "title and content are required" };
  }

  const row = {
    user_id: userId,
    org_id: orgId,
    title,
    content,
    category: (input.category as string) ?? "Note",
    tags: (input.tags as string[]) ?? [],
  };

  const { data, error } = await supabase
    .from("library_items")
    .insert(row)
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create library item: ${error.message}` };

  // Embed the new library item (fire-and-forget)
  embedInBackground(supabase, userId, "library_items", data.id, data);

  return { success: true, message: `Created library item "${data.title}" (${data.category})` };
}

/* ══════════════════════════════════════════════════════════
   DELETE HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleDeleteTeamRoles(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const roleNames = input.role_names as string[];

  if (!teamName || !roleNames?.length) {
    return { success: false, message: "team_name and role_names are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* Load all roles on this team for flexible matching */
  const { data: allRoles } = await supabase
    .from("team_roles")
    .select("id, name")
    .eq("team_id", teamId);

  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const roleName of roleNames) {
    let matches = (allRoles ?? []).filter(
      (r) => r.name.toLowerCase() === roleName.toLowerCase()
    );
    if (matches.length === 0) {
      matches = (allRoles ?? []).filter(
        (r) => r.name.toLowerCase().includes(roleName.toLowerCase()) ||
               roleName.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    if (matches.length > 0) {
      for (const match of matches) {
        await supabase.from("team_roles").delete().eq("id", match.id);
      }
      deleted.push(matches.map((m) => m.name).join(", ") + (matches.length > 1 ? ` (×${matches.length})` : ""));
    } else {
      notFound.push(roleName);
    }
  }

  const parts: string[] = [];
  if (deleted.length > 0) parts.push(`deleted role(s): ${deleted.join(", ")}`);
  if (notFound.length > 0) parts.push(`not found: ${notFound.join(", ")}`);
  return { success: deleted.length > 0, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleDeleteTeamKpis(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const kpiNames = input.kpi_names as string[];

  if (!teamName || !kpiNames?.length) {
    return { success: false, message: "team_name and kpi_names are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* List all KPIs on this team for matching */
  const { data: allKpis } = await supabase
    .from("team_kpis")
    .select("id, name")
    .eq("team_id", teamId);

  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const kpiName of kpiNames) {
    /* Try exact ilike match first, then fall back to contains match */
    let matches = (allKpis ?? []).filter(
      (k) => k.name.toLowerCase() === kpiName.toLowerCase()
    );
    if (matches.length === 0) {
      matches = (allKpis ?? []).filter(
        (k) => k.name.toLowerCase().includes(kpiName.toLowerCase()) ||
               kpiName.toLowerCase().includes(k.name.toLowerCase())
      );
    }

    if (matches.length > 0) {
      for (const match of matches) {
        await supabase.from("team_kpis").delete().eq("id", match.id);
      }
      deleted.push(matches.map((m) => m.name).join(", ") + (matches.length > 1 ? ` (×${matches.length})` : ""));
    } else {
      notFound.push(kpiName);
    }
  }

  const parts: string[] = [];
  if (deleted.length > 0) parts.push(`deleted KPI(s): ${deleted.join(", ")}`);
  if (notFound.length > 0) parts.push(`not found: ${notFound.join(", ")} (existing KPIs: ${(allKpis ?? []).map((k) => k.name).join(", ") || "none"})`);
  return { success: deleted.length > 0, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleDeleteTeamTools(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const teamName = input.team_name as string;
  const toolNames = input.tool_names as string[];

  if (!teamName || !toolNames?.length) {
    return { success: false, message: "team_name and tool_names are required" };
  }

  const teamId = await resolveTeamId(teamName, supabase);
  if (!teamId) return { success: false, message: `Team "${teamName}" not found` };

  /* Load all tools on this team for flexible matching */
  const { data: allTools } = await supabase
    .from("team_tools")
    .select("id, name")
    .eq("team_id", teamId);

  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const toolName of toolNames) {
    let matches = (allTools ?? []).filter(
      (t) => t.name.toLowerCase() === toolName.toLowerCase()
    );
    if (matches.length === 0) {
      matches = (allTools ?? []).filter(
        (t) => t.name.toLowerCase().includes(toolName.toLowerCase()) ||
               toolName.toLowerCase().includes(t.name.toLowerCase())
      );
    }

    if (matches.length > 0) {
      for (const match of matches) {
        await supabase.from("team_tools").delete().eq("id", match.id);
      }
      deleted.push(matches.map((m) => m.name).join(", ") + (matches.length > 1 ? ` (×${matches.length})` : ""));
    } else {
      notFound.push(toolName);
    }
  }

  const parts: string[] = [];
  if (deleted.length > 0) parts.push(`deleted tool(s): ${deleted.join(", ")}`);
  if (notFound.length > 0) parts.push(`not found: ${notFound.join(", ")}`);
  return { success: deleted.length > 0, message: `${parts.join("; ")} on "${teamName}"` };
}

async function handleDeleteGoal(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const goalName = input.goal_name as string;

  if (!goalName) {
    return { success: false, message: "goal_name is required" };
  }

  const goalId = await resolveGoalId(goalName, supabase);
  if (!goalId) return { success: false, message: `Goal "${goalName}" not found` };

  // Get sub-goal IDs before deleting (for chunk cleanup)
  const { data: subGoalIds } = await supabase.from("sub_goals").select("id").eq("goal_id", goalId);

  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  if (error) return { success: false, message: `Failed to delete goal: ${error.message}` };

  // Delete chunks for the goal and its sub-goals (fire-and-forget)
  deleteChunksInBackground(supabase, "goals", goalId);
  for (const sub of subGoalIds ?? []) {
    deleteChunksInBackground(supabase, "sub_goals", sub.id);
  }

  return { success: true, message: `Deleted goal "${goalName}" and all its sub-goals` };
}

/* ══════════════════════════════════════════════════════════
   ORGANIZATION HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleUpdateOrganization(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  /* Build partial update from any provided fields */
  const fields = ["name", "industry", "description", "website", "stage", "target_market", "differentiators", "notes"];
  const updates: Record<string, unknown> = {};
  for (const f of fields) {
    if (input[f] !== undefined && input[f] !== null) {
      updates[f] = input[f];
    }
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, message: "No fields provided to update" };
  }

  updates.updated_at = new Date().toISOString();

  /* Upsert (create if not exists, update if exists) */
  const { data, error } = await supabase
    .from("org_profiles")
    .upsert(
      { user_id: userId, org_id: orgId, ...updates },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return { success: false, message: `Failed to update organization: ${error.message}` };

  const updatedFields = Object.keys(updates).filter((k) => k !== "updated_at").join(", ");
  const orgName = data.name ? ` for "${data.name}"` : "";
  return { success: true, message: `Updated organization${orgName}: ${updatedFields}` };
}

/* ══════════════════════════════════════════════════════════
   TOOL CATALOG & STACK HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleSearchToolCatalog(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const query = input.query as string;
  const category = input.category as string | undefined;

  if (!query) return { success: false, message: "query is required" };

  /* Split query into individual keywords for broader matching */
  const keywords = query
    .split(/[\s,/+&]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);

  /* Strategy 1: try the full query string */
  let baseQ = supabase
    .from("tool_catalog")
    .select("name, category, subcategory, description, key_features, pricing, best_for, integrations, pros, cons, website")
    .or(`name.ilike.%${query}%,subcategory.ilike.%${query}%,description.ilike.%${query}%,best_for.ilike.%${query}%`);

  if (category) {
    baseQ = baseQ.ilike("category", `%${category}%`);
  }

  let { data, error } = await baseQ.limit(20);
  if (error) return { success: false, message: `Search failed: ${error.message}` };

  /* Strategy 2: if no results, try each keyword separately */
  if ((!data || data.length === 0) && keywords.length > 0) {
    const orClauses = keywords
      .flatMap((kw) => [
        `name.ilike.%${kw}%`,
        `subcategory.ilike.%${kw}%`,
        `description.ilike.%${kw}%`,
        `best_for.ilike.%${kw}%`,
      ])
      .join(",");

    let kwQ = supabase
      .from("tool_catalog")
      .select("name, category, subcategory, description, key_features, pricing, best_for, integrations, pros, cons, website")
      .or(orClauses);

    if (category) {
      kwQ = kwQ.ilike("category", `%${category}%`);
    }

    const kwResult = await kwQ.limit(20);
    if (!kwResult.error) {
      data = kwResult.data;
    }
  }

  /* Strategy 3: if still nothing, try category match */
  if ((!data || data.length === 0) && !category) {
    const catQ = await supabase
      .from("tool_catalog")
      .select("name, category, subcategory, description, key_features, pricing, best_for, integrations, pros, cons, website")
      .ilike("category", `%${query}%`)
      .limit(20);

    if (!catQ.error && catQ.data && catQ.data.length > 0) {
      data = catQ.data;
    }
  }

  if (!data || data.length === 0) {
    /* Return available subcategories to help refine */
    const { data: subs } = await supabase
      .from("tool_catalog")
      .select("subcategory")
      .order("subcategory");

    const uniqueSubs = [...new Set((subs ?? []).map((s) => s.subcategory as string).filter(Boolean))];
    return {
      success: true,
      message: `No tools found matching "${query}". Try searching by subcategory:\n${uniqueSubs.join(", ")}`,
    };
  }

  const results = data.map((t) => {
    let entry = `**${t.name}** (${t.category}${t.subcategory ? ` > ${t.subcategory}` : ""})`;
    if (t.pricing) entry += ` — ${t.pricing}`;
    entry += `\n${t.description}`;
    if (t.best_for) entry += `\nBest for: ${t.best_for}`;
    if (t.key_features?.length > 0) entry += `\nKey features: ${t.key_features.join(", ")}`;
    if (t.pros?.length > 0) entry += `\nPros: ${t.pros.join(", ")}`;
    if (t.cons?.length > 0) entry += `\nCons: ${t.cons.join(", ")}`;
    if (t.integrations?.length > 0) entry += `\nIntegrations: ${t.integrations.join(", ")}`;
    return entry;
  });

  return { success: true, message: `Found ${data.length} tool(s):\n\n${results.join("\n\n---\n\n")}` };
}

async function handleAddStackTool(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Tool name is required" };

  /* Check if already in stack */
  const { data: existing } = await supabase
    .from("user_stack_tools")
    .select("id")
    .ilike("name", name)
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, message: `"${name}" is already in your tech stack` };
  }

  /* Try to find in catalog for extra data */
  const { data: catalogMatch } = await supabase
    .from("tool_catalog")
    .select("id, description, category")
    .ilike("name", name)
    .limit(1);

  const cat = catalogMatch?.[0];

  const row = {
    user_id: userId,
    org_id: orgId,
    catalog_id: cat?.id ?? null,
    name,
    description: (input.description as string) ?? cat?.description ?? "",
    category: (input.category as string) ?? cat?.category ?? "",
    teams: (input.teams as string[]) ?? [],
    team_usage: (input.team_usage as Record<string, string>) ?? {},
    status: (input.status as string) ?? "Active",
  };

  const { data, error } = await supabase
    .from("user_stack_tools")
    .insert(row)
    .select()
    .single();

  if (error) return { success: false, message: `Failed to add to stack: ${error.message}` };

  const teamList = (data.teams as string[])?.length > 0 ? ` for teams: ${(data.teams as string[]).join(", ")}` : "";
  return { success: true, message: `Added "${data.name}" to your tech stack (${data.status})${teamList}` };
}

async function handleRemoveStackTool(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Tool name is required" };

  /* Find matching tools in stack */
  const { data: allStack } = await supabase
    .from("user_stack_tools")
    .select("id, name");

  const matches = (allStack ?? []).filter(
    (t) => t.name.toLowerCase() === name.toLowerCase()
  );
  if (matches.length === 0) {
    /* Try fuzzy match */
    const fuzzy = (allStack ?? []).filter(
      (t) => t.name.toLowerCase().includes(name.toLowerCase()) ||
             name.toLowerCase().includes(t.name.toLowerCase())
    );
    if (fuzzy.length > 0) {
      for (const m of fuzzy) {
        await supabase.from("user_stack_tools").delete().eq("id", m.id);
      }
      return { success: true, message: `Removed "${fuzzy.map((m) => m.name).join(", ")}" from your tech stack` };
    }
    return { success: false, message: `"${name}" not found in your tech stack` };
  }

  for (const m of matches) {
    await supabase.from("user_stack_tools").delete().eq("id", m.id);
  }
  return { success: true, message: `Removed "${name}" from your tech stack` };
}

/* ══════════════════════════════════════════════════════════
   PROJECT HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleCreateProject(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Project name is required" };

  const description = (input.description as string) ?? "";
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      org_id: orgId,
      name,
      slug,
      description,
      active_mode: "canvas",
      canvas_blocks: [],
      workflow_nodes: [],
    })
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create project: ${error.message}` };
  return { success: true, message: `Created project "${data.name}" — open it at /projects/${data.slug}` };
}

async function handleUpdateCanvas(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const projectName = input.project_name as string;
  const blocks = input.blocks as Array<{
    type: string;
    content?: string;
    level?: number;
    url?: string;
    alt?: string;
    items?: Array<{ text: string; checked?: boolean }>;
    rows?: string[][];
    language?: string;
    chartType?: string;
    chartData?: Record<string, unknown>[];
    chartConfig?: Record<string, unknown>;
    columns?: Array<Array<{
      type: string;
      content?: string;
      level?: number;
      items?: Array<{ text: string; checked?: boolean }>;
      rows?: string[][];
      language?: string;
    }>>;
  }>;
  const action = (input.action as string) ?? "append";

  if (!projectName || !blocks?.length) {
    return { success: false, message: "project_name and blocks are required" };
  }

  /* Resolve project by name */
  const { data: project } = await supabase
    .from("projects")
    .select("id, canvas_blocks")
    .ilike("name", projectName)
    .single();

  if (!project) return { success: false, message: `Project "${projectName}" not found` };

  const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* Map a single raw block to a block with generated IDs */
  function mapBlock(b: typeof blocks[0]): Record<string, unknown> {
    return {
      id: genId(),
      type: b.type,
      ...(b.content !== undefined && { content: b.content }),
      ...(b.level !== undefined && { level: b.level }),
      ...(b.url !== undefined && { url: b.url }),
      ...(b.alt !== undefined && { alt: b.alt }),
      ...(b.items && {
        items: b.items.map((item) => ({
          id: genId(),
          text: item.text,
          ...(item.checked !== undefined && { checked: item.checked }),
        })),
      }),
      ...(b.rows && { rows: b.rows }),
      ...(b.language !== undefined && { language: b.language }),
      ...(b.chartType && { chartType: b.chartType }),
      ...(b.chartData && { chartData: b.chartData }),
      ...(b.chartConfig && { chartConfig: b.chartConfig }),
      ...(b.columns && {
        columns: b.columns.map((col) =>
          col.map((innerBlock) => mapBlock(innerBlock as typeof blocks[0]))
        ),
      }),
    };
  }

  /* Generate IDs for new blocks (and list items, and nested column blocks) */
  const newBlocks = blocks.map(mapBlock);

  let finalBlocks;
  if (action === "replace") {
    finalBlocks = newBlocks;
  } else {
    /* Append to existing */
    const existing = (project.canvas_blocks as unknown[]) ?? [];
    finalBlocks = [...existing, ...newBlocks];
  }

  const { error } = await supabase
    .from("projects")
    .update({ canvas_blocks: finalBlocks })
    .eq("id", project.id);

  if (error) return { success: false, message: `Failed to update canvas: ${error.message}` };

  const verb = action === "replace" ? "Replaced canvas with" : "Added";
  return { success: true, message: `${verb} ${newBlocks.length} block(s) on "${projectName}" canvas` };
}

/* ── Generate Workflow ─────────────────────────────────── */

const WF_DEFAULT_PORTS: Record<string, string[]> = {
  start:    ["bottom"],
  end:      ["top"],
  process:  ["top", "bottom", "left", "right"],
  decision: ["top", "bottom", "left", "right"],
  ai_agent: ["top", "bottom", "left", "right"],
  note:     [],
};

const WF_DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  start:    { w: 140, h: 48 },
  end:      { w: 140, h: 48 },
  process:  { w: 220, h: 96 },
  decision: { w: 140, h: 140 },
  ai_agent: { w: 220, h: 96 },
  note:     { w: 180, h: 100 },
};

async function handleGenerateWorkflow(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userRole: OrgRole = "viewer"
): Promise<ToolResult> {
  if (!hasMinRole(userRole, "manager")) {
    return { success: false, message: "You need manager, admin, or owner permissions to create workflows. Your current role is " + userRole + "." };
  }
  const projectName = input.project_name as string;
  const rawNodes = input.nodes as Array<{
    temp_id: string;
    type: string;
    title: string;
    description?: string;
    x: number;
    y: number;
    properties?: Record<string, string>;
  }>;
  const rawEdges = input.edges as Array<{
    source_id: string;
    target_id: string;
    source_side?: string;
    target_side?: string;
    label?: string;
  }>;

  if (!projectName || !rawNodes?.length) {
    return { success: false, message: "project_name and nodes are required" };
  }

  /* Resolve project by name */
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .ilike("name", projectName)
    .single();

  if (!project) return { success: false, message: `Project "${projectName}" not found` };

  /* ── Snapshot current workflow before overwriting ── */
  const { data: currentProject } = await supabase
    .from("projects")
    .select("workflow_nodes, workflow_history")
    .eq("id", project.id)
    .single();

  if (currentProject?.workflow_nodes && Array.isArray(currentProject.workflow_nodes) && currentProject.workflow_nodes.length > 0) {
    const existingFlow = currentProject.workflow_nodes[0] as Record<string, unknown>;
    const hasNodes = Array.isArray(existingFlow?.nodes) && (existingFlow.nodes as unknown[]).length > 0;
    if (hasNodes) {
      const history = Array.isArray(currentProject.workflow_history) ? [...currentProject.workflow_history] : [];
      history.unshift({
        snapshot: currentProject.workflow_nodes,
        timestamp: new Date().toISOString(),
        label: "Before AI generation",
        nodeCount: (existingFlow.nodes as unknown[]).length,
      });
      // Keep last 10 versions
      if (history.length > 10) history.length = 10;
      await supabase
        .from("projects")
        .update({ workflow_history: history as unknown as Record<string, unknown>[] })
        .eq("id", project.id);
    }
  }

  const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* Build temp_id → real ID map and create full WorkflowNode objects */
  const idMap = new Map<string, string>();
  const portMap = new Map<string, Map<string, string>>(); // nodeRealId → side → portId

  const nodes = rawNodes.map((n) => {
    const nodeType = n.type || "process";
    const realId = genId();
    idMap.set(n.temp_id, realId);

    const size = WF_DEFAULT_SIZES[nodeType] ?? WF_DEFAULT_SIZES.process;
    const portSides = WF_DEFAULT_PORTS[nodeType] ?? WF_DEFAULT_PORTS.process;

    const ports = portSides.map((side) => {
      const portId = genId();
      if (!portMap.has(realId)) portMap.set(realId, new Map());
      portMap.get(realId)!.set(side, portId);
      return { id: portId, side };
    });

    return {
      id: realId,
      type: nodeType,
      x: n.x ?? 400,
      y: n.y ?? 0,
      width: size.w,
      height: size.h,
      title: n.title,
      description: n.description ?? "",
      properties: n.properties ?? {},
      ports,
    };
  });

  /* Build full WorkflowEdge objects */
  const edges = (rawEdges ?? []).map((e) => {
    const sourceRealId = idMap.get(e.source_id) ?? e.source_id;
    const targetRealId = idMap.get(e.target_id) ?? e.target_id;
    const sourceSide = e.source_side ?? "bottom";
    const targetSide = e.target_side ?? "top";

    const sourcePortId = portMap.get(sourceRealId)?.get(sourceSide) ?? genId();
    const targetPortId = portMap.get(targetRealId)?.get(targetSide) ?? genId();

    return {
      id: genId(),
      sourceNodeId: sourceRealId,
      sourcePortId,
      targetNodeId: targetRealId,
      targetPortId,
      ...(e.label && { label: e.label }),
    };
  });

  /* Store as WorkflowData wrapped in array (matches project page convention) */
  const workflowData = [{ nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }];

  const { error } = await supabase
    .from("projects")
    .update({ workflow_nodes: workflowData as unknown as Record<string, unknown>[] })
    .eq("id", project.id);

  if (error) return { success: false, message: `Failed to generate workflow: ${error.message}` };

  return {
    success: true,
    message: `Generated workflow with ${nodes.length} node(s) and ${edges.length} connection(s) in "${projectName}". Switch to the Builder tab to view it.`,
  };
}

/* ── Generate Workflow from Document ────────────────── */

async function handleGenerateWorkflowFromDocument(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userRole: OrgRole = "viewer"
): Promise<ToolResult> {
  if (!hasMinRole(userRole, "manager")) {
    return { success: false, message: "You need manager, admin, or owner permissions to create workflows. Your current role is " + userRole + "." };
  }
  const projectName = input.project_name as string;
  const documentText = input.document_text as string;
  const documentName = (input.document_name as string) ?? "Document";

  if (!projectName || !documentText) {
    return { success: false, message: "project_name and document_text are required" };
  }

  // Reuse the generate_workflow handler — it does the same node/edge processing
  const result = await handleGenerateWorkflow(
    {
      project_name: projectName,
      nodes: input.nodes,
      edges: input.edges,
    },
    supabase
  );

  if (result.success) {
    return {
      success: true,
      message: `${result.message}\n\nGenerated from document: "${documentName}"`,
    };
  }
  return result;
}

async function handleCompareTools(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const toolNames = input.tool_names as string[];
  if (!toolNames || toolNames.length < 2) {
    return { success: false, message: "Provide at least 2 tool names to compare" };
  }

  const results: string[] = [];
  const notFound: string[] = [];

  for (const name of toolNames.slice(0, 3)) {
    const { data } = await supabase
      .from("tool_catalog")
      .select("*")
      .ilike("name", `%${name}%`)
      .limit(1);

    if (data && data.length > 0) {
      const t = data[0];
      let entry = `## ${t.name}\n`;
      entry += `**Category:** ${t.category}${t.subcategory ? ` > ${t.subcategory}` : ""}\n`;
      if (t.pricing) entry += `**Pricing:** ${t.pricing}\n`;
      if (t.description) entry += `**Description:** ${t.description}\n`;
      if (t.best_for) entry += `**Best for:** ${t.best_for}\n`;
      if (t.key_features?.length > 0) entry += `**Key features:** ${t.key_features.join(", ")}\n`;
      if (t.pros?.length > 0) entry += `**Pros:** ${t.pros.join(", ")}\n`;
      if (t.cons?.length > 0) entry += `**Cons:** ${t.cons.join(", ")}\n`;
      if (t.integrations?.length > 0) entry += `**Integrations:** ${t.integrations.join(", ")}\n`;
      results.push(entry);
    } else {
      notFound.push(name);
    }
  }

  if (results.length === 0) {
    return { success: false, message: `None of the tools (${toolNames.join(", ")}) were found in the catalog` };
  }

  let message = results.join("\n---\n\n");
  if (notFound.length > 0) {
    message += `\n\n(Not found in catalog: ${notFound.join(", ")})`;
  }
  return { success: true, message };
}


/* ═══════════════════════════════════════════════════════════
   CRM HANDLERS
   ═══════════════════════════════════════════════════════════ */

/* ── Helper: resolve company name → id (auto-create if needed) ── */

async function resolveCompanyId(
  companyName: string,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<string | null> {
  if (!companyName) return null;
  const { data } = await supabase
    .from("crm_companies")
    .select("id")
    .ilike("name", companyName)
    .single();
  if (data?.id) return data.id;

  // Auto-create company
  const { data: newCo } = await supabase
    .from("crm_companies")
    .insert({ user_id: userId, org_id: orgId, name: companyName })
    .select("id")
    .single();
  if (newCo?.id) {
    embedInBackground(supabase, userId, "crm_companies", newCo.id, { name: companyName });
    return newCo.id;
  }
  return null;
}

/* ── Helper: resolve contact name → id ── */

async function resolveContactId(
  contactName: string,
  supabase: SupabaseClient
): Promise<string | null> {
  if (!contactName) return null;
  // Try full name match (first + last)
  const parts = contactName.trim().split(/\s+/);
  if (parts.length >= 2) {
    const { data } = await supabase
      .from("crm_contacts")
      .select("id")
      .ilike("first_name", parts[0])
      .ilike("last_name", parts.slice(1).join(" "))
      .single();
    if (data?.id) return data.id;
  }
  // Try email match
  const { data: emailMatch } = await supabase
    .from("crm_contacts")
    .select("id")
    .ilike("email", contactName)
    .single();
  if (emailMatch?.id) return emailMatch.id;
  // Try first name only
  const { data: firstName } = await supabase
    .from("crm_contacts")
    .select("id")
    .ilike("first_name", contactName.trim())
    .limit(1)
    .single();
  return firstName?.id ?? null;
}

/* ── Helper: resolve deal title → id ── */

async function resolveDealId(
  dealTitle: string,
  supabase: SupabaseClient
): Promise<string | null> {
  if (!dealTitle) return null;
  const { data } = await supabase
    .from("crm_deals")
    .select("id")
    .ilike("title", dealTitle)
    .single();
  return data?.id ?? null;
}


/* ── create_contact ── */

async function handleCreateContact(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const firstName = (input.first_name as string)?.trim();
  if (!firstName) return { success: false, message: "first_name is required" };

  let companyId: string | null = null;
  if (input.company_name) {
    companyId = await resolveCompanyId(input.company_name as string, supabase, userId, orgId);
  }

  const { data, error } = await supabase
    .from("crm_contacts")
    .insert({
      user_id: userId,
      org_id: orgId,
      first_name: firstName,
      last_name: ((input.last_name as string) ?? "").trim(),
      email: ((input.email as string) ?? "").trim(),
      phone: ((input.phone as string) ?? "").trim(),
      title: ((input.title as string) ?? "").trim(),
      company_id: companyId,
      status: (input.status as string) || "lead",
      source: (input.source as string) || "ai",
      notes: ((input.notes as string) ?? "").trim(),
      tags: (input.tags as string[]) ?? [],
    })
    .select()
    .single();

  if (error) throw error;

  embedInBackground(supabase, userId, "crm_contacts", data.id, data);

  const name = `${data.first_name} ${data.last_name}`.trim();
  return { success: true, message: `Created contact: ${name} (${data.status})${companyId ? ` at ${input.company_name}` : ""}` };
}


/* ── update_contact ── */

async function handleUpdateContact(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const contactName = (input.contact_name as string)?.trim();
  if (!contactName) return { success: false, message: "contact_name is required" };

  const contactId = await resolveContactId(contactName, supabase);
  if (!contactId) return { success: false, message: `Contact not found: "${contactName}"` };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.first_name !== undefined) updates.first_name = (input.first_name as string).trim();
  if (input.last_name !== undefined) updates.last_name = (input.last_name as string).trim();
  if (input.email !== undefined) updates.email = (input.email as string).trim();
  if (input.phone !== undefined) updates.phone = (input.phone as string).trim();
  if (input.title !== undefined) updates.title = (input.title as string).trim();
  if (input.status !== undefined) updates.status = input.status;
  if (input.notes !== undefined) updates.notes = (input.notes as string).trim();
  if (input.tags !== undefined) updates.tags = input.tags;

  const { data, error } = await supabase
    .from("crm_contacts")
    .update(updates)
    .eq("id", contactId)
    .select()
    .single();

  if (error) throw error;

  reembedInBackground(supabase, data.user_id, "crm_contacts", contactId, data);

  return { success: true, message: `Updated contact: ${data.first_name} ${data.last_name}`.trim() };
}


/* ── create_company ── */

async function handleCreateCompany(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = (input.name as string)?.trim();
  if (!name) return { success: false, message: "name is required" };

  const { data, error } = await supabase
    .from("crm_companies")
    .insert({
      user_id: userId,
      org_id: orgId,
      name,
      domain: ((input.domain as string) ?? "").trim(),
      industry: ((input.industry as string) ?? "").trim(),
      size: (input.size as string) || "",
      description: ((input.description as string) ?? "").trim(),
      website: ((input.website as string) ?? "").trim(),
      phone: ((input.phone as string) ?? "").trim(),
      annual_revenue: (input.annual_revenue as number) ?? null,
      employees: (input.employees as number) ?? null,
      sector: ((input.sector as string) ?? "").trim(),
      account_owner: ((input.account_owner as string) ?? "").trim(),
    })
    .select()
    .single();

  if (error) throw error;

  embedInBackground(supabase, userId, "crm_companies", data.id, data);

  return { success: true, message: `Created company: ${data.name}${data.industry ? ` (${data.industry})` : ""}` };
}


/* ── create_deal ── */

async function handleCreateDeal(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const title = (input.title as string)?.trim();
  if (!title) return { success: false, message: "title is required" };

  let contactId: string | null = null;
  let companyId: string | null = null;
  if (input.contact_name) contactId = await resolveContactId(input.contact_name as string, supabase);
  if (input.company_name) companyId = await resolveCompanyId(input.company_name as string, supabase, userId, orgId);

  const stage = (input.stage as string) || "lead";
  const probMap: Record<string, number> = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };

  const closeReason = ((input.close_reason as string) ?? "").trim();

  const dealRow: Record<string, unknown> = {
    user_id: userId,
    org_id: orgId,
    title,
    value: (input.value as number) ?? 0,
    stage,
    probability: probMap[stage] ?? 10,
    contact_id: contactId,
    company_id: companyId,
    expected_close_date: (input.expected_close_date as string) || null,
    notes: ((input.notes as string) ?? "").trim(),
  };

  // Set close fields if deal is being created as won/lost
  if (stage === "won" || stage === "lost") {
    dealRow.closed_at = new Date().toISOString();
    if (closeReason) dealRow.close_reason = closeReason;
  }

  const { data, error } = await supabase
    .from("crm_deals")
    .insert(dealRow)
    .select()
    .single();

  if (error) throw error;

  // Record initial stage history
  await supabase.from("crm_deal_stage_history").insert({
    user_id: userId,
    org_id: orgId,
    deal_id: data.id,
    from_stage: null,
    to_stage: stage,
    notes: closeReason || "",
  });

  embedInBackground(supabase, userId, "crm_deals", data.id, data);

  const valStr = data.value ? ` ($${Number(data.value).toLocaleString()})` : "";
  return { success: true, message: `Created deal: ${data.title}${valStr} — Stage: ${data.stage}` };
}


/* ── update_deal_stage ── */

async function handleUpdateDealStage(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const dealTitle = (input.deal_title as string)?.trim();
  const newStage = (input.new_stage as string)?.trim();
  if (!dealTitle || !newStage) return { success: false, message: "deal_title and new_stage are required" };

  const dealId = await resolveDealId(dealTitle, supabase);
  if (!dealId) return { success: false, message: `Deal not found: "${dealTitle}"` };

  // Get current deal to know old stage
  const { data: currentDeal } = await supabase.from("crm_deals").select("stage, user_id").eq("id", dealId).single();
  const oldStage = currentDeal?.stage ?? "";

  const probMap: Record<string, number> = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
  const closeReason = ((input.close_reason as string) ?? "").trim();
  const lostTo = ((input.lost_to as string) ?? "").trim();

  const updates: Record<string, unknown> = {
    stage: newStage,
    probability: probMap[newStage] ?? 10,
    updated_at: new Date().toISOString(),
  };
  if (input.notes) updates.notes = (input.notes as string).trim();

  // Handle won/lost close fields
  if (newStage === "won" || newStage === "lost") {
    updates.closed_at = new Date().toISOString();
    if (closeReason) updates.close_reason = closeReason;
    if (lostTo) updates.lost_to = lostTo;
  }
  // Clear close fields when moving away from won/lost
  if (newStage !== "won" && newStage !== "lost" && (oldStage === "won" || oldStage === "lost")) {
    updates.closed_at = null;
    updates.close_reason = "";
    updates.lost_to = "";
  }

  const { data, error } = await supabase
    .from("crm_deals")
    .update(updates)
    .eq("id", dealId)
    .select()
    .single();

  if (error) throw error;

  // Record stage history
  if (oldStage !== newStage && currentDeal?.user_id) {
    await supabase.from("crm_deal_stage_history").insert({
      user_id: currentDeal.user_id,
      org_id: orgId,
      deal_id: dealId,
      from_stage: oldStage,
      to_stage: newStage,
      notes: closeReason || ((input.notes as string) ?? "").trim(),
    });
  }

  reembedInBackground(supabase, data.user_id, "crm_deals", dealId, data);

  let msg = `Updated deal "${data.title}" → ${newStage} (${data.probability}% probability)`;
  if (closeReason) msg += ` — Reason: ${closeReason}`;
  if (lostTo) msg += ` (lost to: ${lostTo})`;
  return { success: true, message: msg };
}


/* ── log_activity ── */

async function handleLogActivity(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const actType = (input.type as string) || "note";
  const subject = (input.subject as string)?.trim();
  if (!subject) return { success: false, message: "subject is required" };

  let contactId: string | null = null;
  let companyId: string | null = null;
  let dealId: string | null = null;
  if (input.contact_name) contactId = await resolveContactId(input.contact_name as string, supabase);
  if (input.company_name) {
    const { data } = await supabase.from("crm_companies").select("id").ilike("name", input.company_name as string).single();
    companyId = data?.id ?? null;
  }
  if (input.deal_title) dealId = await resolveDealId(input.deal_title as string, supabase);

  const { data, error } = await supabase
    .from("crm_activities")
    .insert({
      user_id: userId,
      org_id: orgId,
      type: actType,
      subject,
      description: ((input.description as string) ?? "").trim(),
      contact_id: contactId,
      company_id: companyId,
      deal_id: dealId,
    })
    .select()
    .single();

  if (error) throw error;

  embedInBackground(supabase, userId, "crm_activities", data.id, data);

  let msg = `Logged ${actType}: ${subject}`;
  if (input.contact_name) msg += ` (with ${input.contact_name})`;
  return { success: true, message: msg };
}


/* ── search_crm ── */

async function handleSearchCrm(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const query = (input.query as string)?.trim();
  if (!query) return { success: false, message: "query is required" };

  const entityType = (input.entity_type as string) || "all";
  const results: string[] = [];

  if (entityType === "all" || entityType === "contacts") {
    const { data: contacts } = await supabase
      .from("crm_contacts")
      .select("first_name, last_name, email, title, status")
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10);
    if (contacts?.length) {
      results.push("**Contacts:**");
      for (const c of contacts) {
        results.push(`- ${c.first_name} ${c.last_name} (${c.status}) — ${c.title || ""} ${c.email || ""}`);
      }
    }
  }

  if (entityType === "all" || entityType === "companies") {
    const { data: companies } = await supabase
      .from("crm_companies")
      .select("name, industry, size")
      .or(`name.ilike.%${query}%,industry.ilike.%${query}%`)
      .limit(10);
    if (companies?.length) {
      results.push("**Companies:**");
      for (const c of companies) {
        results.push(`- ${c.name} — ${c.industry || ""} (${c.size || ""})`);
      }
    }
  }

  if (entityType === "all" || entityType === "deals") {
    const { data: deals } = await supabase
      .from("crm_deals")
      .select("title, value, stage")
      .or(`title.ilike.%${query}%,notes.ilike.%${query}%`)
      .limit(10);
    if (deals?.length) {
      results.push("**Deals:**");
      for (const d of deals) {
        results.push(`- ${d.title} — $${Number(d.value).toLocaleString()} (${d.stage})`);
      }
    }
  }

  if (results.length === 0) {
    return { success: true, message: `No CRM records found matching "${query}"` };
  }

  return { success: true, message: results.join("\n") };
}


/* ── get_crm_summary ── */

async function handleGetCrmSummary(
  _input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<ToolResult> {
  const [contactsRes, companiesRes, dealsRes, activitiesRes] = await Promise.all([
    supabase.from("crm_contacts").select("status"),
    supabase.from("crm_companies").select("id", { count: "exact", head: true }),
    supabase.from("crm_deals").select("stage, value"),
    supabase.from("crm_activities").select("type").gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const contacts = contactsRes.data ?? [];
  const statusCounts: Record<string, number> = {};
  for (const c of contacts) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;

  const deals = dealsRes.data ?? [];
  const stageCounts: Record<string, number> = {};
  let activePipeline = 0;
  let wonValue = 0;
  let lostValue = 0;
  let wonCount = 0;
  let lostCount = 0;
  for (const d of deals) {
    stageCounts[d.stage] = (stageCounts[d.stage] ?? 0) + 1;
    const val = Number(d.value);
    if (d.stage === "won") { wonValue += val; wonCount++; }
    else if (d.stage === "lost") { lostValue += val; lostCount++; }
    else { activePipeline += val; }
  }

  const closedCount = wonCount + lostCount;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;
  const avgDealSize = deals.length > 0 ? Math.round(deals.reduce((s, d) => s + Number(d.value), 0) / deals.length) : 0;

  const lines: string[] = [];
  lines.push(`## CRM Summary`);
  lines.push(`**Contacts:** ${contacts.length} total — ${Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
  lines.push(`**Companies:** ${companiesRes.count ?? 0}`);
  lines.push(`**Deals:** ${deals.length} total — ${Object.entries(stageCounts).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
  lines.push(`**Active Pipeline:** $${activePipeline.toLocaleString()}`);
  lines.push(`**Won:** $${wonValue.toLocaleString()} (${wonCount} deals)`);
  lines.push(`**Lost:** $${lostValue.toLocaleString()} (${lostCount} deals)`);
  lines.push(`**Win Rate:** ${winRate}%`);
  lines.push(`**Average Deal Size:** $${avgDealSize.toLocaleString()}`);
  lines.push(`**Activities (last 7 days):** ${activitiesRes.data?.length ?? 0}`);

  return { success: true, message: lines.join("\n") };
}

/* ── Create Product ───────────────────────────────────── */

async function handleCreateProduct(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name?.trim()) return { success: false, message: "Product name is required." };

  const { error } = await supabase.from("crm_products").insert({
    user_id: userId,
    org_id: orgId,
    name: name.trim(),
    sku: ((input.sku as string) ?? "").trim(),
    category: ((input.category as string) ?? "").trim(),
    unit_price: (input.unit_price as number) ?? 0,
    description: ((input.description as string) ?? "").trim(),
  });
  if (error) return { success: false, message: `Failed to create product: ${error.message}` };
  return { success: true, message: `Product "${name}" created successfully.` };
}

/* ── Add Deal Line Item ───────────────────────────────── */

async function handleAddDealLineItem(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const dealTitle = input.deal_title as string;
  const productName = input.product_name as string;
  if (!dealTitle?.trim()) return { success: false, message: "Deal title is required." };
  if (!productName?.trim()) return { success: false, message: "Product name is required." };

  // Find the deal
  const { data: deals } = await supabase.from("crm_deals").select("id").ilike("title", dealTitle.trim());
  if (!deals?.length) return { success: false, message: `Deal "${dealTitle}" not found.` };
  const dealId = deals[0].id;

  // Find the product
  const { data: products } = await supabase.from("crm_products").select("id, name, unit_price").ilike("name", productName.trim());
  const product = products?.[0];
  if (!product) return { success: false, message: `Product "${productName}" not found in catalog. Create it first.` };

  const qty = (input.quantity as number) || 1;
  const price = (input.unit_price as number) ?? product.unit_price ?? 0;
  const discount = (input.discount as number) ?? 0;
  const total = Math.round(qty * price * (1 - discount / 100) * 100) / 100;

  const { error } = await supabase.from("crm_deal_line_items").insert({
    user_id: userId,
    org_id: orgId,
    deal_id: dealId,
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    unit_price: price,
    discount,
    total,
  });
  if (error) return { success: false, message: `Failed to add line item: ${error.message}` };
  return { success: true, message: `Added ${qty}x "${product.name}" to deal "${dealTitle}" (total: $${total.toLocaleString()}).` };
}

/* ── Add Company Asset ────────────────────────────────── */

async function handleAddCompanyAsset(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const companyName = input.company_name as string;
  const productName = input.product_name as string;
  if (!companyName?.trim()) return { success: false, message: "Company name is required." };
  if (!productName?.trim()) return { success: false, message: "Product name is required." };

  // Find the company
  const { data: companies } = await supabase.from("crm_companies").select("id").ilike("name", companyName.trim());
  if (!companies?.length) return { success: false, message: `Company "${companyName}" not found.` };
  const companyId = companies[0].id;

  // Find the product
  const { data: products } = await supabase.from("crm_products").select("id, name").ilike("name", productName.trim());
  const product = products?.[0];
  if (!product) return { success: false, message: `Product "${productName}" not found in catalog. Create it first.` };

  const { error } = await supabase.from("crm_company_assets").insert({
    user_id: userId,
    org_id: orgId,
    company_id: companyId,
    product_id: product.id,
    product_name: product.name,
    quantity: (input.quantity as number) || 1,
    purchase_date: ((input.purchase_date as string) ?? ""),
    renewal_date: ((input.renewal_date as string) ?? ""),
    annual_value: (input.annual_value as number) ?? 0,
    status: ((input.status as string) ?? "active"),
  });
  if (error) return { success: false, message: `Failed to add asset: ${error.message}` };
  return { success: true, message: `Added "${product.name}" to ${companyName}'s installed base.` };
}

/* ── create_report ────────────────────────────────────────── */

const DEFAULT_VISIBLE_COLUMNS: Record<string, string[]> = {
  contacts: ["first_name", "last_name", "email", "status", "company_name"],
  companies: ["name", "industry", "size"],
  deals: ["title", "value", "stage", "expected_close_date"],
  activities: ["type", "subject", "contact_name", "created_at"],
};

async function handleCreateReport(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = (input.name as string)?.trim();
  const entityType = (input.entity_type as string)?.trim();

  if (!name) return { success: false, message: "Report name is required." };
  if (!entityType || !["contacts", "companies", "deals", "activities"].includes(entityType)) {
    return { success: false, message: "entity_type must be one of: contacts, companies, deals, activities." };
  }

  const description = ((input.description as string) ?? "").trim();
  const columns = (input.columns as string[]) ?? DEFAULT_VISIBLE_COLUMNS[entityType] ?? [];
  const filters = (input.filters as Array<{ field: string; operator: string; value: string }>) ?? [];
  const sortField = ((input.sort_field as string) ?? "created_at").trim();
  const sortDirection = ((input.sort_direction as string) ?? "desc").trim();

  const { data, error } = await supabase
    .from("crm_reports")
    .insert({
      user_id: userId,
      org_id: orgId,
      name,
      description,
      entity_type: entityType,
      columns: JSON.stringify(columns),
      filters: JSON.stringify(filters),
      sort_config: JSON.stringify({ field: sortField, direction: sortDirection }),
    })
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create report: ${error.message}` };

  const filterDesc = filters.length > 0 ? `, ${filters.length} filter(s)` : "";
  return {
    success: true,
    message: `Created report "${data.name}" — ${entityType} with ${columns.length} column(s)${filterDesc}. View it in CRM → Reports tab.`,
  };
}

/* ── update_report ───────────────────────────────────────── */

async function handleUpdateReport(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const reportId = (input.report_id as string)?.trim();
  if (!reportId) return { success: false, message: "report_id is required." };

  // Build partial update
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name) updates.name = (input.name as string).trim();
  if (input.description !== undefined) updates.description = (input.description as string).trim();
  if (input.columns) updates.columns = JSON.stringify(input.columns);
  if (input.filters) updates.filters = JSON.stringify(input.filters);
  if (input.sort_field || input.sort_direction) {
    // Fetch existing sort config to merge
    const { data: existing } = await supabase
      .from("crm_reports")
      .select("sort_config")
      .eq("id", reportId)
      .eq("user_id", userId)
      .single();
    const existingSort = typeof existing?.sort_config === "string"
      ? JSON.parse(existing.sort_config)
      : existing?.sort_config ?? { field: "created_at", direction: "desc" };
    updates.sort_config = JSON.stringify({
      field: (input.sort_field as string) ?? existingSort.field,
      direction: (input.sort_direction as string) ?? existingSort.direction,
    });
  }

  const { data, error } = await supabase
    .from("crm_reports")
    .update(updates)
    .eq("id", reportId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return { success: false, message: `Failed to update report: ${error.message}` };

  const changes: string[] = [];
  if (input.name) changes.push(`name → "${data.name}"`);
  if (input.columns) changes.push(`${(input.columns as string[]).length} columns`);
  if (input.filters) changes.push(`${(input.filters as unknown[]).length} filter(s)`);
  if (input.sort_field) changes.push(`sort by ${input.sort_field}`);

  return {
    success: true,
    message: `Updated report "${data.name}": ${changes.join(", ") || "no changes"}. Refresh the report to see updates.`,
  };
}

/* ── import_csv_data ─────────────────────────────────────── */

async function handleImportCsvData(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const csvContent = input.csv_content as string;
  const targetTable = input.target_table as string;
  const fieldMappings = input.field_mappings as Array<{ csv_column: string; target_field: string }>;

  if (!csvContent || !targetTable || !fieldMappings?.length) {
    return { success: false, message: "csv_content, target_table, and field_mappings are required." };
  }

  const validTables = ["crm_contacts", "crm_companies", "crm_deals", "crm_products"];
  if (!validTables.includes(targetTable)) {
    return { success: false, message: `Invalid target table: ${targetTable}` };
  }

  // Parse CSV
  const lines = csvContent.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { success: false, message: "CSV must have a header row and at least one data row." };

  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
        continue;
      }
      if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });

  const numericFields = ["value", "probability", "unit_price", "annual_revenue", "employees"];

  let imported = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];
  const BATCH = 50;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const insertRows = batch.map((row) => {
      const mapped: Record<string, unknown> = { user_id: userId, org_id: orgId };
      for (const m of fieldMappings) {
        const val = row[m.csv_column] ?? "";
        if (numericFields.includes(m.target_field)) {
          const num = parseFloat(val);
          mapped[m.target_field] = isNaN(num) ? 0 : num;
        } else {
          mapped[m.target_field] = val;
        }
      }
      if (targetTable === "crm_contacts" && !mapped.source) {
        mapped.source = "import";
      }
      return mapped;
    });

    const { error } = await supabase.from(targetTable).insert(insertRows);
    if (error) {
      errorCount += batch.length;
      errorDetails.push(`Rows ${i + 1}-${i + batch.length}: ${error.message}`);
    } else {
      imported += batch.length;
    }
  }

  // Log to sync log
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    event_type: errorCount === 0 ? "success" : "warning",
    message: `AI imported ${imported} rows to ${targetTable} (${errorCount} errors)`,
    details: { imported, errors: errorCount, errorDetails },
  });

  return {
    success: imported > 0,
    message: `Imported ${imported} of ${rows.length} rows into ${targetTable}.${errorCount > 0 ? ` ${errorCount} rows failed: ${errorDetails.join("; ")}` : ""}`,
  };
}

/* ═══════════════════════════════════════════════════════════
   ORG MANAGEMENT TOOLS
   ═══════════════════════════════════════════════════════════ */

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 5, admin: 4, manager: 3, user: 2, viewer: 1,
};

/** Check if userRole can invite someone at targetRole */
function canInviteRole(userRole: OrgRole, targetRole: OrgRole): boolean {
  // Owner can invite anyone except owner
  // Admin can invite manager, user, viewer
  // Manager can invite user, viewer
  // User / Viewer cannot invite
  if (targetRole === "owner") return false;
  if (userRole === "owner") return true;
  if (userRole === "admin") return ["manager", "user", "viewer"].includes(targetRole);
  if (userRole === "manager") return ["user", "viewer"].includes(targetRole);
  return false;
}

/* ── invite_member ── */
async function handleInviteMember(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole
): Promise<ToolResult> {
  const email = (input.email as string)?.trim().toLowerCase();
  if (!email) return { success: false, message: "Email address is required." };

  const role = ((input.role as string) || "user") as OrgRole;
  const confirmed = input.confirmed === true;

  // Permission check
  if (!canInviteRole(userRole, role)) {
    if (ROLE_HIERARCHY[userRole] <= ROLE_HIERARCHY["user"]) {
      return { success: false, message: `Your role (${userRole}) does not have permission to invite members. Only managers and above can invite.` };
    }
    return { success: false, message: `As a ${userRole}, you can only invite roles below your level. You cannot invite someone as ${role}.` };
  }

  // Confirmation step
  if (!confirmed) {
    const deptNames = input.department_names as string[] | undefined;
    const deptNote = deptNames?.length ? ` and assign them to: ${deptNames.join(", ")}` : "";
    return {
      success: false,
      message: `CONFIRM_REQUIRED: I'll invite **${email}** as **${role}**${deptNote}. The invite expires in 7 days. Please confirm you'd like to proceed.`,
    };
  }

  // Check for existing pending invite
  const { data: existingInvite } = await supabase
    .from("org_invites")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .single();

  if (existingInvite) {
    return {
      success: false,
      message: `There is already a pending invite for ${email}. Share this link: /invite/${existingInvite.id}`,
    };
  }

  // Resolve department names to IDs
  let departmentIds: string[] = [];
  const deptNames = input.department_names as string[] | undefined;
  if (deptNames && deptNames.length > 0) {
    const { data: depts } = await supabase
      .from("org_departments")
      .select("id, name")
      .eq("org_id", orgId);
    for (const name of deptNames) {
      const found = (depts ?? []).find(
        (d) => d.name.toLowerCase() === name.toLowerCase()
      );
      if (found) departmentIds.push(found.id);
    }
  }

  // Create the invite
  const { data: invite, error } = await supabase
    .from("org_invites")
    .insert({
      org_id: orgId,
      email,
      role,
      department_ids: departmentIds,
      invited_by: userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) return { success: false, message: `Failed to create invite: ${error.message}` };

  const deptNote = departmentIds.length > 0
    ? ` Assigned to ${departmentIds.length} department(s).`
    : "";

  return {
    success: true,
    message: `Invited **${email}** as **${role}**.${deptNote}\n\nShareable invite link: \`/invite/${invite.id}\`\n\nThe invite expires in 7 days.`,
  };
}

/* ── list_members ── */
async function handleListMembers(
  _input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const { data: members, error } = await supabase
    .from("org_members")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at");

  if (error) return { success: false, message: `Failed to load members: ${error.message}` };
  if (!members || members.length === 0) {
    return { success: true, message: "No members found in this organization." };
  }

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, email")
    .eq("org_id", orgId);

  const profileMap: Record<string, { name: string; email: string }> = {};
  for (const p of profiles ?? []) {
    profileMap[p.user_id] = { name: p.display_name || "", email: p.email || "" };
  }

  const { data: pendingInvites } = await supabase
    .from("org_invites")
    .select("email, role, created_at, expires_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const lines = members.map((m) => {
    const profile = profileMap[m.user_id];
    const displayName = profile?.name || profile?.email || m.user_id.slice(0, 8);
    const emailPart = profile?.email ? ` (${profile.email})` : "";
    const selfMarker = m.user_id === userId ? " ← you" : "";
    const joined = new Date(m.created_at).toLocaleDateString();
    return `- **${displayName}**${emailPart} — ${m.role} (joined ${joined})${selfMarker}`;
  });

  let result = `## Organization Members (${members.length})\n${lines.join("\n")}`;

  if (pendingInvites && pendingInvites.length > 0) {
    result += `\n\n## Pending Invites (${pendingInvites.length})\n`;
    for (const inv of pendingInvites) {
      const expires = new Date(inv.expires_at).toLocaleDateString();
      result += `- ${inv.email} — ${inv.role} (expires ${expires})\n`;
    }
  }

  return { success: true, message: result };
}

/* ── update_member_role ── */
async function handleUpdateMemberRole(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole
): Promise<ToolResult> {
  if (!hasMinRole(userRole, "admin")) {
    return { success: false, message: "You need admin or owner permissions to change member roles." };
  }

  const identifier = (input.member_identifier as string)?.trim();
  const newRole = input.new_role as OrgRole;
  const confirmed = input.confirmed === true;

  if (!identifier) return { success: false, message: "Member email or name is required." };
  if (!newRole) return { success: false, message: "New role is required." };
  if (newRole === "owner") return { success: false, message: "Cannot assign the owner role." };

  // Find the member
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, email")
    .eq("org_id", orgId);

  const match = (profiles ?? []).find(
    (p) =>
      p.email?.toLowerCase() === identifier.toLowerCase() ||
      p.display_name?.toLowerCase() === identifier.toLowerCase()
  );

  if (!match) {
    return { success: false, message: `Could not find a member matching "${identifier}". Try using their exact email address.` };
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("user_id", match.user_id)
    .single();

  if (!membership) return { success: false, message: `"${identifier}" is not a member of this organization.` };
  if (membership.role === "owner") return { success: false, message: "Cannot change the owner's role." };
  if (membership.role === newRole) return { success: true, message: `${match.display_name || match.email} already has the ${newRole} role.` };

  // Cannot assign a role ≥ your own (unless owner)
  if (userRole !== "owner" && ROLE_HIERARCHY[newRole] >= ROLE_HIERARCHY[userRole]) {
    return { success: false, message: `You cannot assign a role (${newRole}) that is equal to or above your own role (${userRole}).` };
  }

  const displayName = match.display_name || match.email || identifier;

  // Confirmation step
  if (!confirmed) {
    return {
      success: false,
      message: `CONFIRM_REQUIRED: I'll change **${displayName}**'s role from **${membership.role}** to **${newRole}**. Please confirm you'd like to proceed.`,
    };
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role: newRole })
    .eq("id", membership.id);

  if (error) return { success: false, message: `Failed to update role: ${error.message}` };

  return {
    success: true,
    message: `Changed **${displayName}**'s role from ${membership.role} to **${newRole}**.`,
  };
}

/* ── remove_member ── */
async function handleRemoveMember(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  userRole: OrgRole
): Promise<ToolResult> {
  if (!hasMinRole(userRole, "admin")) {
    return { success: false, message: "You need admin or owner permissions to remove members." };
  }

  const identifier = (input.member_identifier as string)?.trim();
  const confirmed = input.confirmed === true;

  if (!identifier) return { success: false, message: "Member email or name is required." };

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, email")
    .eq("org_id", orgId);

  const match = (profiles ?? []).find(
    (p) =>
      p.email?.toLowerCase() === identifier.toLowerCase() ||
      p.display_name?.toLowerCase() === identifier.toLowerCase()
  );

  if (!match) return { success: false, message: `Could not find a member matching "${identifier}".` };
  if (match.user_id === userId) return { success: false, message: "You cannot remove yourself from the organization." };

  const { data: membership } = await supabase
    .from("org_members")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("user_id", match.user_id)
    .single();

  if (!membership) return { success: false, message: `"${identifier}" is not a member of this organization.` };
  if (membership.role === "owner") return { success: false, message: "Cannot remove the organization owner." };

  const displayName = match.display_name || match.email || identifier;

  // Confirmation step
  if (!confirmed) {
    return {
      success: false,
      message: `CONFIRM_REQUIRED: I'll remove **${displayName}** (${membership.role}) from the organization. This cannot be undone. Please confirm.`,
    };
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("id", membership.id);

  if (error) return { success: false, message: `Failed to remove member: ${error.message}` };

  return { success: true, message: `Removed **${displayName}** (${membership.role}) from the organization.` };
}

/* ── create_department ── */
async function handleCreateDepartmentTool(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userRole: OrgRole
): Promise<ToolResult> {
  if (!hasMinRole(userRole, "admin")) {
    return { success: false, message: "You need admin or owner permissions to create departments." };
  }

  const name = (input.name as string)?.trim();
  if (!name) return { success: false, message: "Department name is required." };

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: existing } = await supabase
    .from("org_departments")
    .select("id")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .single();

  if (existing) return { success: false, message: `A department with the slug "${slug}" already exists.` };

  const { data, error } = await supabase
    .from("org_departments")
    .insert({ org_id: orgId, name, slug })
    .select("name, slug")
    .single();

  if (error) return { success: false, message: `Failed to create department: ${error.message}` };

  return {
    success: true,
    message: `Created department **${data.name}** (/${data.slug}). You can now assign members to this department when inviting them.`,
  };
}

/* ── list_org_info ── */
async function handleListOrgInfo(
  _input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const [orgRes, membersRes, deptsRes, invitesRes] = await Promise.all([
    supabase.from("orgs").select("name, slug, created_at").eq("id", orgId).single(),
    supabase.from("org_members").select("role").eq("org_id", orgId),
    supabase.from("org_departments").select("name, slug").eq("org_id", orgId).order("name"),
    supabase.from("org_invites").select("email, role").eq("org_id", orgId).is("accepted_at", null),
  ]);

  if (!orgRes.data) return { success: false, message: "Organization not found." };

  const org = orgRes.data;
  const members = membersRes.data ?? [];
  const depts = deptsRes.data ?? [];
  const invites = invitesRes.data ?? [];

  const roleCounts: Record<string, number> = {};
  for (const m of members) {
    roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  }
  const roleBreakdown = Object.entries(roleCounts)
    .map(([r, count]) => `${count} ${r}${count !== 1 ? "s" : ""}`)
    .join(", ");

  let result = `## Organization Info\n`;
  result += `**Name:** ${org.name}\n`;
  result += `**Slug:** ${org.slug}\n`;
  result += `**Created:** ${new Date(org.created_at).toLocaleDateString()}\n`;
  result += `**Members:** ${members.length} (${roleBreakdown})\n`;
  result += depts.length > 0
    ? `**Departments:** ${depts.map((d) => d.name).join(", ")}\n`
    : `**Departments:** None\n`;
  result += invites.length > 0
    ? `**Pending Invites:** ${invites.length} (${invites.map((i) => i.email).join(", ")})\n`
    : `**Pending Invites:** None\n`;

  return { success: true, message: result };
}

/* ── E-Commerce handlers ────────────────────────────────── */

async function handleQueryEcommerce(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const entityType = input.entity_type as string;
  const queryType = (input.query_type as string) || "list";
  const filters = (input.filters as Array<{ field: string; operator: string; value?: string }>) || [];
  const sortField = (input.sort_field as string) || "created_at";
  const sortDirection = (input.sort_direction as string) || "desc";
  const limit = Math.min((input.limit as number) || 20, 100);
  const searchQuery = (input.search_query as string) || "";
  const aggregateField = (input.aggregate_field as string) || "";
  const aggregateFunction = (input.aggregate_function as string) || "sum";

  // Handle unified query separately (uses the unified_customers view)
  if (entityType === "unified") {
    return await handleUnifiedCustomerQuery(input, supabase, orgId);
  }

  const tableMap: Record<string, string> = {
    customers: "ecom_customers",
    orders: "ecom_orders",
    products: "ecom_products",
  };

  const table = tableMap[entityType];
  if (!table) {
    return { success: false, message: `Unknown entity type: ${entityType}. Use customers, orders, products, or unified.` };
  }

  try {
    if (queryType === "count") {
      let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
      for (const f of filters) {
        query = applyEcomFilter(query, f);
      }
      const { count, error } = await query;
      if (error) return { success: false, message: `Query error: ${error.message}` };
      return { success: true, message: `Found ${count ?? 0} ${entityType}.` };
    }

    if (queryType === "aggregate") {
      // Supabase doesn't have native aggregation in the client, so we fetch values and compute
      if (!aggregateField) {
        return { success: false, message: "aggregate_field is required for aggregate queries." };
      }
      let query = supabase.from(table).select(aggregateField).eq("org_id", orgId);
      for (const f of filters) {
        query = applyEcomFilter(query, f);
      }
      const { data, error } = await query;
      if (error) return { success: false, message: `Query error: ${error.message}` };
      if (!data || data.length === 0) return { success: true, message: `No ${entityType} found matching filters.` };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values = (data as any[]).map((r) => Number(r[aggregateField]) || 0);
      let result: number;
      switch (aggregateFunction) {
        case "sum": result = values.reduce((a, b) => a + b, 0); break;
        case "avg": result = values.reduce((a, b) => a + b, 0) / values.length; break;
        case "min": result = Math.min(...values); break;
        case "max": result = Math.max(...values); break;
        case "count": result = values.length; break;
        default: result = values.reduce((a, b) => a + b, 0);
      }

      const formatted = aggregateField.includes("price") || aggregateField.includes("spent") || aggregateField.includes("value") || aggregateField.includes("revenue")
        ? `$${result.toFixed(2)}`
        : result.toFixed(2);

      return {
        success: true,
        message: `**${aggregateFunction.toUpperCase()}(${aggregateField})** across ${values.length} ${entityType}: ${formatted}`,
      };
    }

    if (queryType === "search" && searchQuery) {
      // Search across relevant text fields
      const searchFields: Record<string, string[]> = {
        ecom_customers: ["email", "first_name", "last_name"],
        ecom_orders: ["order_number", "email"],
        ecom_products: ["title", "vendor", "product_type"],
      };

      const fields = searchFields[table] || [];
      const orClause = fields.map((f) => `${f}.ilike.%${searchQuery}%`).join(",");

      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("org_id", orgId)
        .or(orClause)
        .order(sortField, { ascending: sortDirection === "asc" })
        .limit(limit);

      if (error) return { success: false, message: `Search error: ${error.message}` };
      if (!data || data.length === 0) return { success: true, message: `No ${entityType} found matching "${searchQuery}".` };

      return {
        success: true,
        message: formatEcomResults(entityType, data),
      };
    }

    // Default: list query
    let query = supabase.from(table).select("*").eq("org_id", orgId);
    for (const f of filters) {
      query = applyEcomFilter(query, f);
    }
    query = query.order(sortField, { ascending: sortDirection === "asc" }).limit(limit);

    const { data, error } = await query;
    if (error) return { success: false, message: `Query error: ${error.message}` };
    if (!data || data.length === 0) return { success: true, message: `No ${entityType} found matching the specified criteria.` };

    return {
      success: true,
      message: formatEcomResults(entityType, data),
    };
  } catch (err) {
    return { success: false, message: `E-commerce query failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyEcomFilter(query: any, filter: { field: string; operator: string; value?: string }) {
  const { field, operator, value } = filter;
  switch (operator) {
    case "eq": return query.eq(field, value);
    case "neq": return query.neq(field, value);
    case "gt": return query.gt(field, value);
    case "gte": return query.gte(field, value);
    case "lt": return query.lt(field, value);
    case "lte": return query.lte(field, value);
    case "like": return query.like(field, value);
    case "ilike": return query.ilike(field, `%${value}%`);
    case "contains": return query.contains(field, [value]);
    case "is_null": return query.is(field, null);
    case "is_not_null": return query.not(field, "is", null);
    default: return query;
  }
}

function formatEcomResults(entityType: string, data: Record<string, unknown>[]): string {
  if (entityType === "customers") {
    const lines = data.map((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
      const spent = c.total_spent ? `$${Number(c.total_spent).toFixed(2)}` : "$0";
      const orders = c.orders_count ?? 0;
      const aov = c.avg_order_value ? `$${Number(c.avg_order_value).toFixed(2)}` : "$0";
      return `- **${name}** (${c.email || "no email"}) — ${orders} orders, LTV: ${spent}, AOV: ${aov}${c.tags && (c.tags as string[]).length ? ` [${(c.tags as string[]).join(", ")}]` : ""}`;
    });
    return `**${data.length} customers:**\n${lines.join("\n")}`;
  }

  if (entityType === "orders") {
    const lines = data.map((o) => {
      const total = o.total_price ? `$${Number(o.total_price).toFixed(2)}` : "N/A";
      const date = o.processed_at ? new Date(o.processed_at as string).toLocaleDateString() : "N/A";
      const items = Array.isArray(o.line_items) ? (o.line_items as unknown[]).length : 0;
      return `- **${o.order_number || o.external_id}** — ${total}, ${o.financial_status || "unknown"}, ${items} items, ${date}`;
    });
    return `**${data.length} orders:**\n${lines.join("\n")}`;
  }

  if (entityType === "products") {
    const lines = data.map((p) => {
      const variants = Array.isArray(p.variants) ? (p.variants as unknown[]).length : 0;
      return `- **${p.title}** — ${p.product_type || "no type"}, ${p.vendor || "no vendor"}, ${variants} variants, ${p.status || "active"}${p.tags && (p.tags as string[]).length ? ` [${(p.tags as string[]).join(", ")}]` : ""}`;
    });
    return `**${data.length} products:**\n${lines.join("\n")}`;
  }

  return `Found ${data.length} records.`;
}

/**
 * Query the unified_customers view that combines CRM + ecom data.
 * Supports filtering by classification (customer, lead, prospect, ecom_only).
 */
async function handleUnifiedCustomerQuery(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const queryType = (input.query_type as string) || "list";
  const filters = (input.filters as Array<{ field: string; operator: string; value?: string }>) || [];
  const sortField = (input.sort_field as string) || "last_updated";
  const sortDirection = (input.sort_direction as string) || "desc";
  const limit = Math.min((input.limit as number) || 20, 100);
  const searchQuery = (input.search_query as string) || "";

  try {
    // The unified_customers view doesn't have RLS but filters by org_id
    // We use it via the Supabase client which respects the view

    if (queryType === "count") {
      let query = supabase.from("unified_customers").select("crm_contact_id", { count: "exact", head: true }).eq("org_id", orgId);
      for (const f of filters) {
        query = applyEcomFilter(query, f);
      }
      const { count, error } = await query;
      if (error) return { success: false, message: `Query error: ${error.message}` };
      return { success: true, message: `Found ${count ?? 0} unified customer records.` };
    }

    if (queryType === "search" && searchQuery) {
      const orClause = `email.ilike.%${searchQuery}%,first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`;
      const { data, error } = await supabase
        .from("unified_customers")
        .select("*")
        .eq("org_id", orgId)
        .or(orClause)
        .order(sortField, { ascending: sortDirection === "asc" })
        .limit(limit);

      if (error) return { success: false, message: `Search error: ${error.message}` };
      if (!data || data.length === 0) return { success: true, message: `No customers found matching "${searchQuery}".` };

      return { success: true, message: formatUnifiedResults(data) };
    }

    // Default: list
    let query = supabase.from("unified_customers").select("*").eq("org_id", orgId);
    for (const f of filters) {
      query = applyEcomFilter(query, f);
    }
    query = query.order(sortField, { ascending: sortDirection === "asc" }).limit(limit);

    const { data, error } = await query;
    if (error) return { success: false, message: `Query error: ${error.message}` };
    if (!data || data.length === 0) return { success: true, message: `No unified customer records found matching the criteria.` };

    return { success: true, message: formatUnifiedResults(data) };
  } catch (err) {
    return { success: false, message: `Unified query failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

function formatUnifiedResults(data: Record<string, unknown>[]): string {
  // Group by classification
  const byClass: Record<string, Record<string, unknown>[]> = {};
  for (const row of data) {
    const cls = (row.classification as string) || "unknown";
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(row);
  }

  const classLabels: Record<string, string> = {
    customer: "🛒 Customers (has purchases)",
    lead: "📋 Leads (CRM only, no purchases)",
    prospect: "🔍 Prospects (in CRM + ecom, no orders yet)",
    ecom_only: "📦 E-com Only (not in CRM)",
  };

  let result = `**${data.length} people across CRM + e-commerce:**\n\n`;

  for (const [cls, rows] of Object.entries(byClass)) {
    result += `### ${classLabels[cls] || cls} (${rows.length})\n`;
    for (const r of rows) {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown";
      const email = (r.email as string) || "no email";
      const parts: string[] = [];

      if (r.total_spent && Number(r.total_spent) > 0) parts.push(`LTV: $${Number(r.total_spent).toFixed(2)}`);
      if (r.orders_count && Number(r.orders_count) > 0) parts.push(`${r.orders_count} orders`);
      if (r.crm_status) parts.push(`CRM: ${r.crm_status}`);
      if (r.title) parts.push(r.title as string);

      result += `- **${name}** (${email})${parts.length ? " — " + parts.join(", ") : ""}\n`;
    }
    result += "\n";
  }

  return result;
}
