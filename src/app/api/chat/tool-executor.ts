import { SupabaseClient } from "@supabase/supabase-js";
import { embedInBackground, reembedInBackground, deleteChunksInBackground } from "@/lib/embeddings/index";
import { hybridSearch } from "@/lib/embeddings/search";
import { hasMinRole } from "@/lib/org";
import type { OrgRole, SegmentRule, BrandAssetType, EmailType, KlaviyoConfig } from "@/lib/types/database";
import { pushSegmentToList } from "@/lib/klaviyo/sync-service";
import { emitToolEvent } from "@/lib/agentic/event-emitter";
import { syncRecordToGraphInBackground } from "@/lib/agentic/graph-sync";
import {
  discoverSegments,
  createSegment as createSegmentFn,
  getSegmentTree,
  getSegmentMembers,
  getCustomerProfile,
  findCustomerByEmailOrName,
} from "@/lib/segmentation/behavioral-engine";
import {
  saveBrandAsset,
  listBrandAssets,
  generateEmailContent,
  listGeneratedEmails,
  getGeneratedEmail,
} from "@/lib/email/email-generator";
import {
  createCampaign,
  generateCampaignVariants,
  sendCampaign,
  getCampaignStatus,
  planCampaignStrategy,
} from "@/lib/email/campaign-engine";
import type { CampaignType, CampaignEmailType, DeliveryChannel } from "@/lib/types/database";

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
      case "import_data":
        return await handleImportData(input, supabase, userId, orgId);
      /* E-Commerce tools */
      case "query_ecommerce":
        return await handleQueryEcommerce(input, supabase, orgId);
      case "search_order_line_items":
        return await handleSearchOrderLineItems(input, supabase, orgId);
      case "search_tool_results":
        return await handleSearchToolResults(input, supabase, userId);
      case "query_ecommerce_analytics":
        return await handleQueryEcommerceAnalytics(input, supabase, orgId);
      /* Inline rendering tools */
      case "create_inline_table":
        return await handleCreateInlineTable(input);
      case "create_inline_chart":
        return await handleCreateInlineChart(input);
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
      /* Segmentation tools */
      case "discover_segments":
        return await handleDiscoverSegments(input, supabase, orgId);
      case "create_segment":
        return await handleCreateSegment(input, supabase, userId, orgId);
      case "list_segments":
        return await handleListSegments(input, supabase, orgId);
      case "get_segment_details":
        return await handleGetSegmentDetails(input, supabase, orgId);
      case "get_customer_behavioral_profile":
        return await handleGetCustomerBehavioralProfile(input, supabase, orgId);
      case "delete_segment":
        return await handleDeleteSegment(input, supabase, orgId);

      // Email Content Engine
      case "save_brand_asset":
        return await handleSaveBrandAsset(input, supabase, orgId, userId);
      case "list_brand_assets":
        return await handleListBrandAssets(input, supabase, orgId);
      case "generate_email":
        return await handleGenerateEmail(input, supabase, orgId, userId);
      case "list_generated_emails":
        return await handleListGeneratedEmails(input, supabase, orgId);
      case "get_generated_email":
        return await handleGetGeneratedEmail(input, supabase, orgId);

      // Klaviyo Push
      case "push_segment_to_klaviyo":
        return await handlePushSegmentToKlaviyo(input, supabase, userId, orgId);

      // Campaign Engine
      case "generate_campaign":
        return await handleGenerateCampaign(input, supabase, orgId, userId);
      case "send_campaign":
        return await handleSendCampaign(input, supabase, orgId);
      case "create_sequence":
        return await handleCreateSequence(input, supabase, orgId, userId);
      case "get_campaign_status":
        return await handleGetCampaignStatus(input, supabase, orgId);
      case "plan_campaign_strategy":
        return await handlePlanCampaignStrategy(input, supabase, orgId, userId);
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

/* ═══════════════════════════════════════════════════════════
   UNIFIED DATA IMPORT — ONE TOOL FOR ALL IMPORTS
   Routes to CRM (simple insert) or Ecom (smart dedup/link)
   ═══════════════════════════════════════════════════════════ */

async function handleImportData(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const csvContent = input.csv_content as string;
  const targetType = input.target_type as string;
  const fieldMappings = (input.field_mappings ?? []) as Array<{ csv_column: string; target_field: string }>;

  if (!csvContent) return { success: false, message: "csv_content is required." };
  if (!targetType) return { success: false, message: "target_type is required." };
  if (!fieldMappings.length) return { success: false, message: "field_mappings is required." };

  const validTypes = ["crm_contacts", "crm_companies", "crm_deals", "crm_products", "ecom_customers", "ecom_orders", "ecom_both"];
  if (!validTypes.includes(targetType)) {
    return { success: false, message: `Invalid target_type: ${targetType}. Valid: ${validTypes.join(", ")}` };
  }

  // ── Parse CSV (handles comma + tab delimiters, quoted fields) ──
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
      if ((ch === "," || ch === "\t") && !inQuotes) { result.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const lines = csvContent.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { success: false, message: "Data must have a header row and at least one data row." };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });

  // ═══════════════════════════════════════════════════════
  // CRM PATH — simple row-by-row insert
  // ═══════════════════════════════════════════════════════
  if (targetType.startsWith("crm_")) {
    const crmNumericFields = ["value", "probability", "unit_price", "annual_revenue", "employees"];
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
          if (crmNumericFields.includes(m.target_field)) {
            const num = parseFloat(val);
            mapped[m.target_field] = isNaN(num) ? 0 : num;
          } else {
            mapped[m.target_field] = val;
          }
        }
        if (targetType === "crm_contacts" && !mapped.source) {
          mapped.source = "import";
        }
        return mapped;
      });

      const { error } = await supabase.from(targetType).insert(insertRows);
      if (error) {
        errorCount += batch.length;
        errorDetails.push(`Rows ${i + 1}-${i + batch.length}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    await supabase.from("data_sync_log").insert({
      user_id: userId,
      org_id: orgId,
      event_type: errorCount === 0 ? "success" : "warning",
      message: `AI imported ${imported} rows to ${targetType} (${errorCount} errors)`,
      details: { imported, errors: errorCount, errorDetails },
    });

    return {
      success: imported > 0,
      message: `**Import Complete**\nImported ${imported} of ${rows.length} rows into ${targetType}.${errorCount > 0 ? ` ${errorCount} rows failed: ${errorDetails.slice(0, 3).join("; ")}` : ""}`,
    };
  }

  // ═══════════════════════════════════════════════════════
  // ECOM PATH — smart dedup, order linking, aggregates
  // ═══════════════════════════════════════════════════════
  const isEcomBoth = targetType === "ecom_both";
  const importCustomers = targetType === "ecom_customers" || isEcomBoth;
  const importOrders = targetType === "ecom_orders" || isEcomBoth;

  // Separate field mappings by prefix/type
  const customerMappings: Array<{ csv_column: string; target_field: string }> = [];
  const orderMappings: Array<{ csv_column: string; target_field: string }> = [];
  const lineitemMappings: Array<{ csv_column: string; target_field: string }> = []; // lineitem_ prefix → collapsed into line_items JSONB array
  const addrMappings: Array<{ csv_column: string; target_field: string }> = []; // addr_ prefix → customer default_address / billing
  const shipMappings: Array<{ csv_column: string; target_field: string }> = []; // ship_ prefix → order shipping_address

  const ecomCustomerFields = ["email", "full_name", "first_name", "last_name", "phone", "tags", "orders_count", "total_spent", "accepts_marketing"];
  const ecomOrderFields = [
    "order_number", "total_price", "subtotal_price", "total_tax", "total_discounts",
    "total_shipping", "currency", "financial_status", "fulfillment_status",
    "line_items_text", "shipping_address_text", "tags", "note",
    "source_name", "processed_at", "discount_code", "shipping_method",
  ];
  const ecomNumericFields = ["total_price", "subtotal_price", "total_tax", "total_discounts", "total_shipping", "orders_count", "total_spent"];

  for (const m of fieldMappings) {
    if (m.target_field.startsWith("addr_")) {
      addrMappings.push({ csv_column: m.csv_column, target_field: m.target_field.replace("addr_", "") });
    } else if (m.target_field.startsWith("ship_")) {
      shipMappings.push({ csv_column: m.csv_column, target_field: m.target_field.replace("ship_", "") });
    } else if (m.target_field.startsWith("lineitem_")) {
      lineitemMappings.push({ csv_column: m.csv_column, target_field: m.target_field.replace("lineitem_", "") });
    } else if (ecomCustomerFields.includes(m.target_field)) {
      customerMappings.push(m);
    } else if (ecomOrderFields.includes(m.target_field)) {
      orderMappings.push(m);
    } else if (m.target_field === "email") {
      // email goes to both
      customerMappings.push(m);
    }
  }

  // Ensure email is mapped
  const emailMapping = customerMappings.find((m) => m.target_field === "email");
  if (!emailMapping) {
    return { success: false, message: "For ecom imports, you must map an 'email' field for customer deduplication." };
  }

  // ── Helpers ──
  function extractMapped(row: Record<string, string>, mappings: Array<{ csv_column: string; target_field: string }>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of mappings) {
      const val = row[m.csv_column] ?? "";
      if (!val) continue;
      if (ecomNumericFields.includes(m.target_field)) {
        const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
        out[m.target_field] = isNaN(num) ? 0 : num;
      } else if (m.target_field === "tags") {
        out[m.target_field] = val.split(",").map((t) => t.trim()).filter(Boolean);
      } else if (m.target_field === "processed_at") {
        const d = new Date(val);
        out[m.target_field] = isNaN(d.getTime()) ? null : d.toISOString();
      } else {
        out[m.target_field] = val;
      }
    }
    return out;
  }

  function extractAddress(row: Record<string, string>, mappings: Array<{ csv_column: string; target_field: string }>): Record<string, string> | null {
    if (!mappings.length) return null;
    const addr: Record<string, string> = {};
    let hasValue = false;
    for (const m of mappings) {
      const val = row[m.csv_column] ?? "";
      if (val) { addr[m.target_field] = val; hasValue = true; }
    }
    return hasValue ? addr : null;
  }

  let customersCreated = 0;
  let customersExisting = 0;
  let ordersCreated = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  // ── Group rows by email for dedup ──
  const emailToRows = new Map<string, Record<string, string>[]>();
  // Also track unique orders per email (for Shopify-style where multiple rows = one order)
  const orderNumMapping = orderMappings.find((m) => m.target_field === "order_number");
  const emailToOrderNumbers = new Map<string, Set<string>>();

  for (const row of rows) {
    const email = (row[emailMapping.csv_column] ?? "").trim().toLowerCase();
    if (!email) continue;
    const existing = emailToRows.get(email) ?? [];
    existing.push(row);
    emailToRows.set(email, existing);

    // Track unique order numbers per email
    if (orderNumMapping) {
      const orderNum = (row[orderNumMapping.csv_column] ?? "").trim();
      if (orderNum) {
        const orders = emailToOrderNumbers.get(email) ?? new Set();
        orders.add(orderNum);
        emailToOrderNumbers.set(email, orders);
      }
    }
  }

  const emailToCustomerId = new Map<string, string>();

  // Check which customers already exist
  const allEmails = [...emailToRows.keys()];
  if (allEmails.length > 0) {
    const LOOKUP_BATCH = 200;
    for (let i = 0; i < allEmails.length; i += LOOKUP_BATCH) {
      const batch = allEmails.slice(i, i + LOOKUP_BATCH);
      const { data: existing } = await supabase
        .from("ecom_customers")
        .select("id, email")
        .eq("org_id", orgId)
        .in("email", batch);
      if (existing) {
        for (const c of existing) {
          emailToCustomerId.set((c.email as string).toLowerCase(), c.id as string);
          customersExisting++;
        }
      }
    }
  }

  // Insert new customers
  const newCustomerEmails = allEmails.filter((e) => !emailToCustomerId.has(e));
  if (newCustomerEmails.length > 0 && importCustomers) {
    const BATCH = 50;
    for (let i = 0; i < newCustomerEmails.length; i += BATCH) {
      const batchEmails = newCustomerEmails.slice(i, i + BATCH);
      const insertRows = batchEmails.map((email) => {
        const firstRow = emailToRows.get(email)![0];
        const mapped = extractMapped(firstRow, customerMappings);
        const address = extractAddress(firstRow, addrMappings);
        const allRowsForEmail = emailToRows.get(email)!;

        // Count unique orders (not line item rows) for this customer
        const uniqueOrders = emailToOrderNumbers.get(email);
        const orderCount = uniqueOrders ? uniqueOrders.size : allRowsForEmail.length;

        // Sum total_spent from first row of each unique order only (not from line item rows)
        let totalSpent = 0;
        if (isEcomBoth && uniqueOrders && orderNumMapping) {
          const seenOrders = new Set<string>();
          for (const r of allRowsForEmail) {
            const orderNum = (r[orderNumMapping.csv_column] ?? "").trim();
            if (orderNum && !seenOrders.has(orderNum)) {
              seenOrders.add(orderNum);
              const orderFields = extractMapped(r, orderMappings);
              totalSpent += (orderFields.total_price as number) || 0;
            }
          }
        } else if (isEcomBoth) {
          totalSpent = allRowsForEmail.reduce((sum, r) => {
            const orderFields = extractMapped(r, orderMappings);
            return sum + ((orderFields.total_price as number) || 0);
          }, 0);
        } else {
          totalSpent = (mapped.total_spent as number) || 0;
        }

        // Split full_name into first/last if they aren't already mapped
        let firstName = (mapped.first_name as string) || null;
        let lastName = (mapped.last_name as string) || null;
        const fullName = (mapped.full_name as string) || null;
        if (fullName && (!firstName || !lastName)) {
          const parts = fullName.trim().split(/\s+/);
          if (!firstName) firstName = parts[0] || null;
          if (!lastName) lastName = parts.slice(1).join(" ") || null;
        }

        return {
          org_id: orgId,
          external_id: `import-${email}`,
          external_source: "import",
          email,
          first_name: firstName,
          last_name: lastName,
          phone: (mapped.phone as string) || null,
          tags: (mapped.tags as string[]) || [],
          default_address: address,
          accepts_marketing: (mapped.accepts_marketing as string) === "yes" || (mapped.accepts_marketing as string) === "true" || false,
          orders_count: orderCount,
          total_spent: Math.round(totalSpent * 100) / 100,
          metadata: { imported_by: userId, imported_at: new Date().toISOString() },
        };
      });

      const { data: inserted, error } = await supabase
        .from("ecom_customers")
        .insert(insertRows)
        .select("id, email");

      if (error) {
        errorCount += batchEmails.length;
        errorDetails.push(`Customers batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      } else if (inserted) {
        for (const c of inserted) {
          emailToCustomerId.set((c.email as string).toLowerCase(), c.id as string);
          customersCreated++;
        }
      }
    }
  }

  // ── Insert orders (with line item grouping for Shopify-style exports) ──
  if (importOrders && (orderMappings.length > 0 || lineitemMappings.length > 0)) {
    const BATCH = 50;

    // Detect order_number mapping for grouping
    const orderNumMapping = orderMappings.find((m) => m.target_field === "order_number");
    const hasLineitemFields = lineitemMappings.length > 0;

    // Group rows by order_number if present (Shopify-style: multiple rows per order = line items)
    // Otherwise treat each row as a separate order
    const orderGroups = new Map<string, Record<string, string>[]>();

    for (const row of rows) {
      const email = (row[emailMapping.csv_column] ?? "").trim().toLowerCase();
      // Don't skip rows without email — import as unlinked orders

      const orderNum = orderNumMapping ? (row[orderNumMapping.csv_column] ?? "").trim() : "";
      const groupKey = orderNum || `row-${orderGroups.size}`;

      const existing = orderGroups.get(groupKey) ?? [];
      existing.push(row);
      orderGroups.set(groupKey, existing);
    }

    // Build one order per group
    const orderRows: Record<string, unknown>[] = [];
    let orderIdx = 0;

    for (const [groupKey, groupRows] of orderGroups) {
      // First row has the full order details (Shopify pattern)
      const primaryRow = groupRows[0];
      const email = (primaryRow[emailMapping.csv_column] ?? "").trim().toLowerCase();
      const customerId = email ? emailToCustomerId.get(email) : undefined;
      const mapped = extractMapped(primaryRow, orderMappings);
      const shipAddress = extractAddress(primaryRow, shipMappings);

      // Build line_items array from all rows in this group
      const lineItems: unknown[] = [];
      if (hasLineitemFields) {
        for (const row of groupRows) {
          const item: Record<string, unknown> = {};
          for (const m of lineitemMappings) {
            const val = row[m.csv_column] ?? "";
            if (!val) continue;
            if (m.target_field === "quantity" || m.target_field === "price") {
              const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
              item[m.target_field] = isNaN(num) ? 0 : num;
            } else {
              item[m.target_field] = val;
            }
          }
          // Only add if there's at least a name or sku
          if (item.name || item.sku || item.title) {
            lineItems.push(item);
          }
        }
      } else if (mapped.line_items_text) {
        lineItems.push({ title: mapped.line_items_text as string, quantity: 1, price: (mapped.total_price as number) || 0 });
      }

      let shippingAddress = shipAddress;
      if (mapped.shipping_address_text && !shippingAddress) {
        shippingAddress = { address1: mapped.shipping_address_text as string };
      }

      const orderNumber = (mapped.order_number as string) || `IMP-${Date.now()}-${orderIdx}`;
      orderIdx++;

      orderRows.push({
        org_id: orgId,
        external_id: `import-${orderNumber}`,
        external_source: "import",
        customer_id: customerId || null,
        customer_external_id: email,
        order_number: orderNumber,
        email,
        financial_status: (mapped.financial_status as string) || "paid",
        fulfillment_status: (mapped.fulfillment_status as string) || "fulfilled",
        total_price: (mapped.total_price as number) || 0,
        subtotal_price: (mapped.subtotal_price as number) || (mapped.total_price as number) || 0,
        total_tax: (mapped.total_tax as number) || 0,
        total_discounts: (mapped.total_discounts as number) || 0,
        total_shipping: (mapped.total_shipping as number) || 0,
        currency: (mapped.currency as string) || "USD",
        line_items: lineItems,
        shipping_address: shippingAddress,
        tags: (mapped.tags as string[]) || [],
        note: (mapped.note as string) || null,
        source_name: (mapped.source_name as string) || "import",
        processed_at: (mapped.processed_at as string) || new Date().toISOString(),
        metadata: { imported_by: userId, imported_at: new Date().toISOString() },
      });
    }

    const insertedOrderIds: string[] = [];
    for (let i = 0; i < orderRows.length; i += BATCH) {
      const batch = orderRows.slice(i, i + BATCH);
      const { data: insertedOrders, error } = await supabase.from("ecom_orders").insert(batch).select("id, order_number, total_price, financial_status, customer_id");
      if (error) {
        errorCount += batch.length;
        errorDetails.push(`Orders batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      } else {
        ordersCreated += batch.length;
        if (insertedOrders) {
          for (const o of insertedOrders) insertedOrderIds.push(o.id as string);
          // Sync orders to graph (fire-and-forget, cap at 500 to avoid overwhelming)
          for (const o of insertedOrders.slice(0, 500)) {
            syncRecordToGraphInBackground(supabase, orgId, "ecom_orders", o.id as string, o as Record<string, unknown>, userId);
          }
        }
      }
    }

    // Update customer aggregates
    if (ordersCreated > 0) {
      for (const [email, custId] of emailToCustomerId) {
        const custRows = emailToRows.get(email);
        if (!custRows) continue;

        const { data: orderAgg } = await supabase
          .from("ecom_orders")
          .select("total_price, processed_at")
          .eq("org_id", orgId)
          .eq("customer_id", custId)
          .order("processed_at", { ascending: true });

        if (orderAgg && orderAgg.length > 0) {
          const totalSpent = orderAgg.reduce((s, o) => s + ((o.total_price as number) || 0), 0);
          const avgOrder = totalSpent / orderAgg.length;
          const firstOrder = orderAgg[0].processed_at as string;
          const lastOrder = orderAgg[orderAgg.length - 1].processed_at as string;

          await supabase
            .from("ecom_customers")
            .update({
              orders_count: orderAgg.length,
              total_spent: Math.round(totalSpent * 100) / 100,
              avg_order_value: Math.round(avgOrder * 100) / 100,
              first_order_at: firstOrder,
              last_order_at: lastOrder,
              updated_at: new Date().toISOString(),
            })
            .eq("id", custId);
        }
      }
    }
  }

  // ── Sync new customers to graph ──
  if (customersCreated > 0) {
    const newEmails = newCustomerEmails.slice(0, 500);
    for (const email of newEmails) {
      const custId = emailToCustomerId.get(email);
      if (custId) {
        const firstRow = emailToRows.get(email)?.[0];
        const custFields = firstRow ? extractMapped(firstRow, customerMappings) : {};
        const record: Record<string, unknown> = {
          id: custId,
          email,
          first_name: custFields.first_name || null,
          last_name: custFields.last_name || null,
          total_spent: custFields.total_spent || 0,
          orders_count: custFields.orders_count || 0,
        };
        syncRecordToGraphInBackground(supabase, orgId, "ecom_customers", custId, record, userId);
      }
    }
  }

  // ── Log result ──
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    event_type: errorCount === 0 ? "success" : "warning",
    message: `AI imported ecom data: ${customersCreated} new customers (${customersExisting} existing), ${ordersCreated} orders (${errorCount} errors)`,
    details: { customersCreated, customersExisting, ordersCreated, errors: errorCount, errorDetails },
  });

  // Build column list from mappings for AI context
  const importedColumns = fieldMappings.map((m) => m.target_field).join(", ");

  let message = `**Import Complete** (${rows.length} rows processed)\n`;
  message += `- **Customers:** ${customersCreated} new, ${customersExisting} already existed\n`;
  if (ordersCreated > 0) message += `- **Orders:** ${ordersCreated} imported (grouped from ${rows.length} line item rows)\n`;
  if (errorCount > 0) message += `- **Errors:** ${errorCount} — ${errorDetails.slice(0, 3).join("; ")}\n`;
  message += `- **Columns imported:** ${importedColumns}\n`;
  message += `- **All data synced to graph** as nodes and edges for AI queries\n`;
  message += `\nData is available in the Explorer. Now show the user a summary table of what was imported using query_ecommerce. You can also compute behavioral profiles and create segments from this data.`;

  return { success: customersCreated > 0 || ordersCreated > 0, message };
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
  let { field } = filter;
  const { operator, value } = filter;

  // Normalize JSONB arrow notation: "default_address->zip" → "default_address->>zip"
  // PostgREST uses ->> for text extraction from JSONB (needed for eq, ilike, etc.)
  if (field.includes("->") && !field.includes("->>")) {
    field = field.replace("->", "->>");
  }

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

/** Format a JSONB address object into a readable string */
function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, unknown>;
  const parts = [
    a.address1,
    a.address2,
    a.city,
    a.province || a.province_code,
    a.zip,
    a.country || a.country_code,
  ].filter(Boolean);
  return parts.join(", ");
}

function formatEcomResults(entityType: string, data: Record<string, unknown>[]): string {
  if (entityType === "customers") {
    const lines = data.map((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
      const spent = c.total_spent ? `$${Number(c.total_spent).toFixed(2)}` : "$0";
      const orders = c.orders_count ?? 0;
      const aov = c.avg_order_value ? `$${Number(c.avg_order_value).toFixed(2)}` : "$0";
      const addrStr = formatAddress(c.default_address);
      return `- **${name}** (${c.email || "no email"}) — ${orders} orders, LTV: ${spent}, AOV: ${aov}${addrStr ? `, Address: ${addrStr}` : ""}${c.tags && (c.tags as string[]).length ? ` [${(c.tags as string[]).join(", ")}]` : ""}`;
    });
    return `**${data.length} customers:**\n${lines.join("\n")}`;
  }

  if (entityType === "orders") {
    const lines = data.map((o) => {
      const total = o.total_price ? `$${Number(o.total_price).toFixed(2)}` : "N/A";
      const date = o.processed_at ? new Date(o.processed_at as string).toLocaleDateString() : "N/A";
      const items = Array.isArray(o.line_items) ? (o.line_items as unknown[]).length : 0;
      const shipAddr = formatAddress(o.shipping_address);
      const billAddr = formatAddress(o.billing_address);
      // Show shipping address if available, else billing
      const addrStr = shipAddr || billAddr;
      return `- **${o.order_number || o.external_id}** — ${total}, ${o.financial_status || "unknown"}, ${items} items, ${date}${addrStr ? `, Ship to: ${addrStr}` : ""}`;
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

/* ── Tool Result Search Handler (uses existing vector search) ── */

async function handleSearchToolResults(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string
): Promise<ToolResult> {
  const query = input.query as string;
  const limit = Math.min((input.limit as number) || 5, 20);

  if (!query) {
    return { success: false, message: "query is required." };
  }

  try {
    // Use existing hybrid search infrastructure, filtered to tool_result source
    const results = await hybridSearch(supabase, userId, query, {
      limit,
      sourceFilter: ["tool_result"],
    });

    if (results.length === 0) {
      return {
        success: true,
        message: "No matching data found in stored tool results. The data may not have been stored yet or the search terms didn't match.",
      };
    }

    let message = `**Found ${results.length} matching chunks from previous tool results:**\n\n`;
    for (const r of results) {
      message += `---\n${r.chunkText}\n\n`;
    }

    return { success: true, message };
  } catch (err) {
    return {
      success: false,
      message: `Search failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/* ── Order Line Item Search Handler ──────────────────────── */

async function handleSearchOrderLineItems(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const searchTerms = (input.search_terms as string[]) || [];
  const resultType = (input.result_type as string) || "top_customers";
  const sortBy = (input.sort_by as string) || "spend";
  const limit = Math.min((input.limit as number) || 10, 50);

  if (searchTerms.length === 0) {
    return { success: false, message: "search_terms is required. Provide product name keywords to search for." };
  }

  // Build ILIKE conditions for each search term against line item title/name
  const ilikeClauses = searchTerms.map((term) => {
    const escaped = term.replace(/'/g, "''");
    return `(item->>'title' ILIKE '%${escaped}%' OR item->>'name' ILIKE '%${escaped}%')`;
  }).join(" OR ");

  try {
    if (resultType === "top_customers") {
      const sortColumn = sortBy === "quantity" ? "total_quantity" : sortBy === "orders" ? "order_count" : "total_spend";
      const { data, error } = await supabase.rpc("exec_sql", {
        query: `
          WITH matching_items AS (
            SELECT
              o.customer_id,
              item->>'title' AS product_title,
              COALESCE((item->>'quantity')::int, 1) AS quantity,
              COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::int, 1) AS line_total
            FROM ecom_orders o,
            LATERAL jsonb_array_elements(o.line_items) AS item
            WHERE o.org_id = '${orgId}'
              AND o.customer_id IS NOT NULL
              AND o.line_items IS NOT NULL
              AND jsonb_array_length(o.line_items) > 0
              AND (${ilikeClauses})
          ),
          customer_totals AS (
            SELECT
              customer_id,
              SUM(line_total) AS total_spend,
              SUM(quantity) AS total_quantity,
              COUNT(DISTINCT product_title) AS distinct_products,
              array_agg(DISTINCT product_title) AS products_bought
            FROM matching_items
            GROUP BY customer_id
          ),
          ranked AS (
            SELECT
              ct.*,
              (SELECT COUNT(DISTINCT o2.id) FROM ecom_orders o2,
               LATERAL jsonb_array_elements(o2.line_items) AS item2
               WHERE o2.customer_id = ct.customer_id
                 AND o2.org_id = '${orgId}'
                 AND (${ilikeClauses.replace(/item/g, "item2")})) AS order_count,
              ec.email,
              ec.first_name,
              ec.last_name,
              ec.total_spent AS lifetime_spend,
              ec.orders_count AS lifetime_orders,
              ec.default_address
            FROM customer_totals ct
            JOIN ecom_customers ec ON ec.id = ct.customer_id AND ec.org_id = '${orgId}'
            ORDER BY ${sortColumn} DESC
            LIMIT ${limit}
          )
          SELECT * FROM ranked
        `,
      });

      if (error) {
        // Fallback: use simpler query without exec_sql
        return await handleSearchLineItemsFallback(supabase, orgId, searchTerms, resultType, sortBy, limit);
      }

      if (!data || (data as unknown[]).length === 0) {
        return { success: true, message: `No orders found containing products matching: ${searchTerms.join(", ")}. Try broader search terms.` };
      }

      const rows = data as Record<string, unknown>[];
      const matchedCustomerIds = rows.map((r) => r.customer_id as string).filter(Boolean);
      let result = `**Top ${rows.length} customers by ${sortBy} on matching products** (searched: ${searchTerms.join(", ")}):\n\n`;
      for (const r of rows) {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown";
        const products = Array.isArray(r.products_bought) ? (r.products_bought as string[]).join(", ") : "—";
        const addrStr = formatAddress(r.default_address);
        result += `- **${name}** (${r.email || "no email"}) — $${Number(r.total_spend || 0).toFixed(2)} on ${r.total_quantity || 0} items across ${r.order_count || 0} orders\n`;
        result += `  Products: ${products}\n`;
        result += `  Lifetime: $${Number(r.lifetime_spend || 0).toFixed(2)} total, ${r.lifetime_orders || 0} orders\n`;
        if (addrStr) result += `  Address: ${addrStr}\n`;
        result += "\n";
      }
      result += `\n_customer_ids: ${JSON.stringify(matchedCustomerIds)}_`;
      return { success: true, message: result };

    } else if (resultType === "product_summary") {
      return await handleSearchLineItemsFallback(supabase, orgId, searchTerms, "product_summary", sortBy, limit);

    } else {
      // order_list
      return await handleSearchLineItemsFallback(supabase, orgId, searchTerms, "order_list", sortBy, limit);
    }
  } catch (err) {
    // Fallback to the simpler query approach
    return await handleSearchLineItemsFallback(supabase, orgId, searchTerms, resultType, sortBy, limit);
  }
}

/**
 * Fallback line item search using client-side JSONB filtering.
 * Used when exec_sql RPC is not available.
 */
async function handleSearchLineItemsFallback(
  supabase: SupabaseClient,
  orgId: string,
  searchTerms: string[],
  resultType: string,
  sortBy: string,
  limit: number
): Promise<ToolResult> {
  // Fetch orders with line items and customer data
  const { data: orders, error } = await supabase
    .from("ecom_orders")
    .select("id, order_number, customer_id, total_price, processed_at, line_items")
    .eq("org_id", orgId)
    .not("line_items", "is", null)
    .not("customer_id", "is", null)
    .order("processed_at", { ascending: false })
    .limit(5000);

  if (error) return { success: false, message: `Query error: ${error.message}` };
  if (!orders || orders.length === 0) return { success: true, message: "No orders found." };

  // Filter orders with matching line items
  const lowerTerms = searchTerms.map((t) => t.toLowerCase());

  interface MatchedItem {
    orderId: string;
    orderNumber: string;
    customerId: string;
    productTitle: string;
    quantity: number;
    lineTotal: number;
    processedAt: string;
  }

  const matchedItems: MatchedItem[] = [];

  for (const order of orders) {
    const items = Array.isArray(order.line_items) ? order.line_items : [];
    for (const item of items) {
      const title = ((item as Record<string, unknown>).title as string || (item as Record<string, unknown>).name as string || "").toLowerCase();
      if (lowerTerms.some((term) => title.includes(term))) {
        const qty = Number((item as Record<string, unknown>).quantity) || 1;
        const price = Number((item as Record<string, unknown>).price) || 0;
        matchedItems.push({
          orderId: order.id,
          orderNumber: order.order_number || order.id,
          customerId: order.customer_id,
          productTitle: (item as Record<string, unknown>).title as string || (item as Record<string, unknown>).name as string || "Unknown",
          quantity: qty,
          lineTotal: price * qty,
          processedAt: order.processed_at || "",
        });
      }
    }
  }

  if (matchedItems.length === 0) {
    return { success: true, message: `No orders found containing products matching: ${searchTerms.join(", ")}. Try broader search terms or check product names in your catalog.` };
  }

  if (resultType === "product_summary") {
    // Aggregate by product title
    const productMap = new Map<string, { revenue: number; quantity: number; orders: Set<string> }>();
    for (const item of matchedItems) {
      const existing = productMap.get(item.productTitle) ?? { revenue: 0, quantity: 0, orders: new Set<string>() };
      existing.revenue += item.lineTotal;
      existing.quantity += item.quantity;
      existing.orders.add(item.orderId);
      productMap.set(item.productTitle, existing);
    }

    const products = Array.from(productMap.entries())
      .map(([title, stats]) => ({ title, ...stats, orderCount: stats.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    let result = `**${products.length} products matching "${searchTerms.join(", ")}":**\n\n`;
    for (const p of products) {
      result += `- **${p.title}** — $${p.revenue.toFixed(2)} revenue, ${p.quantity} units, ${p.orderCount} orders\n`;
    }
    return { success: true, message: result };

  } else if (resultType === "order_list") {
    // Group by order
    const orderMap = new Map<string, { orderNumber: string; items: string[]; total: number; date: string }>();
    for (const item of matchedItems) {
      const existing = orderMap.get(item.orderId) ?? { orderNumber: item.orderNumber, items: [], total: 0, date: item.processedAt };
      existing.items.push(`${item.productTitle} (×${item.quantity})`);
      existing.total += item.lineTotal;
      orderMap.set(item.orderId, existing);
    }

    const orderList = Array.from(orderMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    let result = `**${orderList.length} orders containing matching products:**\n\n`;
    for (const o of orderList) {
      const date = o.date ? new Date(o.date).toLocaleDateString() : "N/A";
      result += `- **#${o.orderNumber}** (${date}) — $${o.total.toFixed(2)}: ${o.items.join(", ")}\n`;
    }
    return { success: true, message: result };

  } else {
    // top_customers — aggregate by customer
    const custMap = new Map<string, { spend: number; quantity: number; orders: Set<string>; products: Set<string> }>();
    for (const item of matchedItems) {
      const existing = custMap.get(item.customerId) ?? { spend: 0, quantity: 0, orders: new Set<string>(), products: new Set<string>() };
      existing.spend += item.lineTotal;
      existing.quantity += item.quantity;
      existing.orders.add(item.orderId);
      existing.products.add(item.productTitle);
      custMap.set(item.customerId, existing);
    }

    const customerIds = Array.from(custMap.keys());
    const { data: customers } = await supabase
      .from("ecom_customers")
      .select("id, email, first_name, last_name, total_spent, orders_count, default_address")
      .in("id", customerIds.slice(0, 100))
      .eq("org_id", orgId);

    const custDetails = new Map((customers ?? []).map((c) => [c.id, c]));

    const sortFn = sortBy === "quantity"
      ? (a: [string, typeof custMap extends Map<string, infer V> ? V : never], b: [string, typeof custMap extends Map<string, infer V> ? V : never]) => b[1].quantity - a[1].quantity
      : sortBy === "orders"
        ? (a: [string, { orders: Set<string> }], b: [string, { orders: Set<string> }]) => b[1].orders.size - a[1].orders.size
        : (a: [string, { spend: number }], b: [string, { spend: number }]) => b[1].spend - a[1].spend;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ranked = Array.from(custMap.entries()).sort(sortFn as any).slice(0, limit);
    // IMPORTANT: _customer_ids must match the displayed ranked results, not all matches.
    // Otherwise segment creation will insert wrong customers.
    const rankedIds = ranked.map(([id]) => id);

    let result = `**Top ${ranked.length} customers by ${sortBy} on matching products** (searched: ${searchTerms.join(", ")}):\n\n`;
    for (const [custId, stats] of ranked) {
      const c = custDetails.get(custId) as Record<string, unknown> | undefined;
      const name = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown" : "Unknown";
      const email = (c?.email as string) || "no email";
      const products = Array.from(stats.products).join(", ");
      const addrStr = c ? formatAddress(c.default_address) : "";
      result += `- **${name}** (${email}) — $${stats.spend.toFixed(2)} on ${stats.quantity} items across ${stats.orders.size} orders\n`;
      result += `  Products: ${products}\n`;
      if (c) result += `  Lifetime: $${Number(c.total_spent || 0).toFixed(2)} total, ${c.orders_count || 0} orders\n`;
      if (addrStr) result += `  Address: ${addrStr}\n`;
      result += "\n";
    }
    result += `\n_customer_ids: ${JSON.stringify(rankedIds)}_`;
    return { success: true, message: result };
  }
}

/* ── E-Commerce Analytics Handler ────────────────────────── */

async function handleQueryEcommerceAnalytics(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const metric = input.metric as string;
  const timeRange = (input.time_range as string) || "12m";
  const groupBy = (input.group_by as string) || "month";
  const limit = Math.min((input.limit as number) || 10, 50);
  const sortBy = (input.sort_by as string) || "revenue";
  const comparePrevious = (input.compare_previous as boolean) || false;

  // Calculate date cutoff based on time range
  const now = new Date();
  let cutoffDate: Date;
  switch (timeRange) {
    case "30d": cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    case "90d": cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
    case "6m": cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, 1); break;
    case "12m": cutoffDate = new Date(now.getFullYear(), now.getMonth() - 12, 1); break;
    default: cutoffDate = new Date(0); // "all"
  }
  const cutoffISO = cutoffDate.toISOString();

  try {
    switch (metric) {
      case "revenue": {
        const { data: periods, error } = await supabase.rpc("analytics_revenue_by_period", {
          p_org_id: orgId,
          p_cutoff: cutoffISO,
          p_group_by: groupBy,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const grouped = (periods as Array<{ period: string; revenue: number; order_count: number }>) || [];
        if (grouped.length === 0) return { success: true, message: "No orders found in the selected time range." };

        let comparisonText = "";
        if (comparePrevious && grouped.length >= 2) {
          const current = grouped[grouped.length - 1];
          const previous = grouped[grouped.length - 2];
          const change = current.revenue - previous.revenue;
          const pct = previous.revenue > 0 ? ((change / previous.revenue) * 100).toFixed(1) : "N/A";
          comparisonText = `\n\n**Period comparison:** ${current.period} ($${current.revenue.toLocaleString()}) vs ${previous.period} ($${previous.revenue.toLocaleString()}) — ${change >= 0 ? "+" : ""}$${change.toLocaleString()} (${change >= 0 ? "+" : ""}${pct}%)`;
        }

        const totalRevenue = grouped.reduce((sum, g) => sum + g.revenue, 0);
        const totalOrders = grouped.reduce((sum, g) => sum + g.order_count, 0);
        const chartData = grouped.map((g) => ({ period: g.period, revenue: Math.round(g.revenue * 100) / 100 }));

        return {
          success: true,
          message: `**Revenue Analysis (${timeRange})**\nTotal: $${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nOrders: ${totalOrders}\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "bar", title: `Revenue by ${groupBy}`, data: chartData, x_key: "period", y_keys: ["revenue"], colors: ["#2563eb"] })}-->${comparisonText}`,
        };
      }

      case "aov": {
        const { data: periods, error } = await supabase.rpc("analytics_revenue_by_period", {
          p_org_id: orgId,
          p_cutoff: cutoffISO,
          p_group_by: groupBy,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const grouped = (periods as Array<{ period: string; revenue: number; order_count: number }>) || [];
        if (grouped.length === 0) return { success: true, message: "No orders found in the selected time range." };

        const totalRevenue = grouped.reduce((sum, g) => sum + g.revenue, 0);
        const totalOrders = grouped.reduce((sum, g) => sum + g.order_count, 0);
        const overallAOV = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        const chartData = grouped.map((g) => ({
          period: g.period,
          aov: g.order_count > 0 ? Math.round((g.revenue / g.order_count) * 100) / 100 : 0,
        }));

        return {
          success: true,
          message: `**Average Order Value (${timeRange})**\nOverall AOV: $${overallAOV.toFixed(2)}\nOrders analyzed: ${totalOrders}\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "line", title: `AOV by ${groupBy}`, data: chartData, x_key: "period", y_keys: ["aov"], colors: ["#16a34a"] })}-->`,
        };
      }

      case "ltv": {
        const { data: customers, error } = await supabase
          .from("ecom_customers")
          .select("first_name, last_name, email, total_spent, orders_count, avg_order_value, first_order_at, last_order_at")
          .eq("org_id", orgId)
          .gt("total_spent", 0)
          .order("total_spent", { ascending: false })
          .limit(limit);

        if (error) return { success: false, message: `Query error: ${error.message}` };
        if (!customers || customers.length === 0) return { success: true, message: "No customers with purchases found." };

        const headers = ["Customer", "LTV", "Orders", "AOV", "First Order", "Last Order"];
        const rows = customers.map((c) => {
          const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.email as string) || "Unknown";
          return [
            name,
            `$${Number(c.total_spent).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            String(c.orders_count ?? 0),
            `$${Number(c.avg_order_value || 0).toFixed(2)}`,
            c.first_order_at ? new Date(c.first_order_at as string).toLocaleDateString() : "N/A",
            c.last_order_at ? new Date(c.last_order_at as string).toLocaleDateString() : "N/A",
          ];
        });

        const chartData = customers.slice(0, 10).map((c) => ({
          customer: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
          ltv: Math.round(Number(c.total_spent) * 100) / 100,
        }));

        return {
          success: true,
          message: `**Top ${customers.length} Customers by Lifetime Value**\n\n<!--INLINE_TABLE:${JSON.stringify({ title: "Customer LTV Rankings", headers, rows, footer: `Showing top ${customers.length} customers by total spend` })}-->\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "bar", title: "Top Customers by LTV", data: chartData, x_key: "customer", y_keys: ["ltv"], colors: ["#8b5cf6"] })}-->`,
        };
      }

      case "repeat_rate": {
        const { data: stats, error } = await supabase.rpc("analytics_repeat_rate", {
          p_org_id: orgId,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const rr = stats as { total: number; one_time: number; repeat: number; repeat_pct: number; distribution: Array<{ order_bucket: string; customers: number }> };
        if (!rr || rr.total === 0) return { success: true, message: "No customers with orders found." };

        const chartData = (rr.distribution || []).map((d) => ({
          orders: `${d.order_bucket} order${d.order_bucket === "1" ? "" : "s"}`,
          customers: d.customers,
        }));

        return {
          success: true,
          message: `**Repeat Purchase Rate**\n- Total customers: ${rr.total}\n- Repeat customers (2+ orders): ${rr.repeat} (${rr.repeat_pct}%)\n- One-time buyers: ${rr.one_time}\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "bar", title: "Customer Order Distribution", data: chartData, x_key: "orders", y_keys: ["customers"], colors: ["#f59e0b"] })}-->`,
        };
      }

      case "top_products": {
        const { data: products, error } = await supabase.rpc("analytics_top_products", {
          p_org_id: orgId,
          p_cutoff: cutoffISO,
          p_limit: limit,
          p_sort_by: sortBy,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const sorted = (products as Array<{ title: string; revenue: number; quantity_sold: number; order_count: number }>) || [];
        if (sorted.length === 0) return { success: true, message: "No orders found in the selected time range." };

        const headers = ["Product", "Revenue", "Units Sold", "Orders"];
        const rows = sorted.map((p) => [
          p.title,
          `$${p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          String(p.quantity_sold),
          String(p.order_count),
        ]);

        const chartData = sorted.slice(0, 10).map((p) => ({
          product: p.title.length > 25 ? p.title.slice(0, 22) + "..." : p.title,
          revenue: Math.round(p.revenue * 100) / 100,
        }));

        return {
          success: true,
          message: `**Top ${sorted.length} Products (${timeRange}, sorted by ${sortBy})**\n\n<!--INLINE_TABLE:${JSON.stringify({ title: "Product Performance", headers, rows, footer: `Top ${sorted.length} products by ${sortBy}` })}-->\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "bar", title: "Top Products by Revenue", data: chartData, x_key: "product", y_keys: ["revenue"], colors: ["#ec4899"] })}-->`,
        };
      }

      case "cohort": {
        const { data: cohorts, error } = await supabase.rpc("analytics_cohort", {
          p_org_id: orgId,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const cohortData = (cohorts as Array<{ cohort: string; customers: number; total_revenue: number; total_orders: number; repeat_pct: number; avg_ltv: number }>) || [];
        if (cohortData.length === 0) return { success: true, message: "No customer cohort data found." };

        const headers = ["Cohort", "Customers", "Revenue", "Avg LTV", "Repeat %"];
        const rows = cohortData.map((c) => [
          c.cohort,
          String(c.customers),
          `$${c.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `$${c.avg_ltv.toFixed(2)}`,
          `${(c.repeat_pct || 0).toFixed(0)}%`,
        ]);

        const chartData = cohortData.map((c) => ({
          cohort: c.cohort,
          customers: c.customers,
          avg_ltv: Math.round(c.avg_ltv * 100) / 100,
        }));

        return {
          success: true,
          message: `**Customer Cohort Analysis**\n\n<!--INLINE_TABLE:${JSON.stringify({ title: "Cohort Breakdown", headers, rows })}-->\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "bar", title: "Customers by Cohort", data: chartData, x_key: "cohort", y_keys: ["customers"], colors: ["#2563eb"] })}-->`,
        };
      }

      case "rfm": {
        const { data: rfmResult, error } = await supabase.rpc("analytics_rfm_segments", {
          p_org_id: orgId,
          p_limit: limit,
        });

        if (error) return { success: false, message: `Query error: ${error.message}` };
        const rfm = rfmResult as { segments: Array<{ segment: string; customers: number }>; top_customers: Array<{ name: string; email: string; recency_days: number; frequency: number; monetary: number; r_score: number; f_score: number; m_score: number; segment: string }> };
        if (!rfm || !rfm.segments || rfm.segments.length === 0) return { success: true, message: "No customers with orders found for RFM analysis." };

        const segChartData = rfm.segments.map((s) => ({ segment: s.segment, customers: s.customers }));

        const topScored = rfm.top_customers || [];
        const headers = ["Customer", "Segment", "R", "F", "M", "Days Since Order", "Orders", "Spend"];
        const rows = topScored.map((c) => [
          c.name?.trim() || c.email || "Unknown",
          c.segment,
          String(c.r_score),
          String(c.f_score),
          String(c.m_score),
          String(c.recency_days),
          String(c.frequency),
          `$${c.monetary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        ]);

        return {
          success: true,
          message: `**RFM Customer Segmentation**\n\n<!--INLINE_CHART:${JSON.stringify({ chart_type: "pie", title: "Customer Segments", data: segChartData, x_key: "segment", y_keys: ["customers"], colors: ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#6b7280"] })}-->\n\n<!--INLINE_TABLE:${JSON.stringify({ title: `Top ${topScored.length} Customers (RFM Scored)`, headers, rows, footer: "R=Recency, F=Frequency, M=Monetary (1=best, 5=worst)" })}-->`,
        };
      }

      default:
        return { success: false, message: `Unknown metric: ${metric}. Use: revenue, aov, ltv, repeat_rate, top_products, cohort, rfm.` };
    }
  } catch (err) {
    return { success: false, message: `Analytics query failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

/** Group orders by time period for trend analysis */
function groupOrdersByPeriod(
  orders: Array<{ total_price: unknown; processed_at?: unknown; created_at?: unknown }>,
  groupBy: string
): Array<{ period: string; revenue: number; count: number }> {
  const groups: Record<string, { revenue: number; count: number }> = {};

  for (const order of orders) {
    const dateStr = (order.processed_at || order.created_at) as string;
    if (!dateStr) continue;
    const date = new Date(dateStr);
    let key: string;

    switch (groupBy) {
      case "day":
        key = date.toISOString().split("T")[0];
        break;
      case "week": {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = `Week of ${weekStart.toISOString().split("T")[0]}`;
        break;
      }
      default: // month
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    if (!groups[key]) groups[key] = { revenue: 0, count: 0 };
    groups[key].revenue += Number(order.total_price || 0);
    groups[key].count += 1;
  }

  return Object.entries(groups)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, data]) => ({ period, ...data }));
}

/* ── Inline Table Handler ─────────────────────────────────── */

async function handleCreateInlineTable(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const title = (input.title as string) || "";
  const headers = input.headers as string[];
  const rows = input.rows as string[][];
  const footer = (input.footer as string) || "";

  if (!headers || !rows) {
    return { success: false, message: "headers and rows are required." };
  }

  const tablePayload = { title, headers, rows, footer };

  return {
    success: true,
    message: `<!--INLINE_TABLE:${JSON.stringify(tablePayload)}-->`,
  };
}

/* ── Inline Chart Handler ─────────────────────────────────── */

async function handleCreateInlineChart(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const chartType = (input.chart_type as string) || "bar";
  const title = (input.title as string) || "";
  const data = input.data as Record<string, unknown>[];
  const xKey = input.x_key as string;
  const yKeys = input.y_keys as string[];
  const colors = (input.colors as string[]) || [];

  if (!data || !xKey || !yKeys) {
    return { success: false, message: "data, x_key, and y_keys are required." };
  }

  const chartPayload = { chart_type: chartType, title, data, x_key: xKey, y_keys: yKeys, colors };

  return {
    success: true,
    message: `<!--INLINE_CHART:${JSON.stringify(chartPayload)}-->`,
  };
}

/* ═══════════════════════════════════════════════════════════
   Segmentation tools
   ═══════════════════════════════════════════════════════════ */

async function handleDiscoverSegments(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const minSize = (input.min_size as number) ?? 5;

  try {
    const discovered = await discoverSegments(supabase, orgId, { minSize: minSize });

    if (discovered.length === 0) {
      return {
        success: true,
        message: "No segments found with the minimum size criteria. Try lowering the min_size or ensuring behavioral profiles have been computed (need customers with 2+ orders).",
      };
    }

    // Build table for discovered segments
    const headers = ["Segment", "Customers", "Lifecycle", "Product Focus", "Interval", "Engagement", "Comm Style"];
    const rows = discovered.map((s) => [
      s.suggested_name,
      String(s.customer_count),
      s.lifecycle_stage,
      s.top_product_type || "varied",
      s.avg_purchase_interval_days ? `${s.avg_purchase_interval_days}d` : "—",
      String(s.avg_engagement),
      s.comm_style || "unknown",
    ]);

    const tablePayload = {
      title: `Discovered Customer Segments (min ${minSize} customers)`,
      headers,
      rows,
      footer: `${discovered.length} natural segments found. Use create_segment to save any of these.`,
    };

    return {
      success: true,
      message: `Found ${discovered.length} natural customer segments:\n\n<!--INLINE_TABLE:${JSON.stringify(tablePayload)}-->\n\n${discovered.map((s, i) =>
        `**${i + 1}. ${s.suggested_name}** (${s.customer_count} customers)\n` +
        `   Avg purchase interval: ${s.avg_purchase_interval_days ? s.avg_purchase_interval_days + ' days' : 'N/A'}\n` +
        `   Engagement: ${s.avg_engagement} | Consistency: ${s.avg_consistency}\n` +
        `   RFM: R=${s.avg_rfm.recency} F=${s.avg_rfm.frequency} M=${s.avg_rfm.monetary}`
      ).join('\n\n')}`,
    };
  } catch (err) {
    return { success: false, message: `Segment discovery failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleCreateSegment(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  const name = input.name as string;
  const description = input.description as string | undefined;
  const segmentType = input.segment_type as string | undefined;
  const rules = input.rules as Record<string, unknown>;
  const parentSegmentId = input.parent_segment_id as string | undefined;
  const branchDimension = input.branch_dimension as string | undefined;
  const branchValue = input.branch_value as string | undefined;
  const customerIds = input.customer_ids as string[] | undefined;

  if (!name || !rules) {
    return { success: false, message: "name and rules are required." };
  }

  try {
    // If customer_ids provided, use direct population mode (AI-first approach)
    if (customerIds && customerIds.length > 0) {
      return await handleCreateSegmentDirect(
        supabase, orgId, userId, name, description, segmentType, rules, customerIds,
        parentSegmentId, branchDimension, branchValue
      );
    }

    const segment = await createSegmentFn(supabase, orgId, userId, {
      name,
      description,
      segment_type: (segmentType as "behavioral" | "rfm" | "product_affinity" | "lifecycle" | "custom") ?? "behavioral",
      rules: rules as unknown as SegmentRule,
      parent_segment_id: parentSegmentId,
      branch_dimension: branchDimension,
      branch_value: branchValue,
    });

    return {
      success: true,
      message: `Segment "${segment.name}" created successfully!\n` +
        `- **ID:** ${segment.id}\n` +
        `- **Type:** ${segment.segment_type}\n` +
        `- **Members assigned:** ${segment.members_assigned} customers\n` +
        (segment.parent_id ? `- **Parent:** ${segment.parent_id}\n` : "") +
        (segment.branch_dimension ? `- **Branch:** ${segment.branch_dimension} = ${segment.branch_value}\n` : ""),
    };
  } catch (err) {
    return { success: false, message: `Failed to create segment: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

/**
 * Direct segment creation — bypasses rule engine and directly inserts customer IDs.
 * Used when the AI already knows exactly which customers to include (e.g. from search_order_line_items).
 */
async function handleCreateSegmentDirect(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  name: string,
  description: string | undefined,
  segmentType: string | undefined,
  rules: Record<string, unknown>,
  customerIds: string[],
  parentSegmentId?: string,
  branchDimension?: string,
  branchValue?: string,
): Promise<ToolResult> {
  // Resolve parent depth/path if needed
  let depth = 0;
  let path: string[] = [];

  if (parentSegmentId) {
    const { data: parent } = await supabase
      .from("segments")
      .select("id, depth, path")
      .eq("id", parentSegmentId)
      .single();
    if (parent) {
      depth = (parent.depth as number) + 1;
      path = [...((parent.path as string[]) ?? []), parent.id as string];
    }
  }

  // Create segment record
  const { data: segment, error: insertErr } = await supabase
    .from("segments")
    .insert({
      org_id: orgId,
      name,
      description: description ?? null,
      segment_type: segmentType ?? "product_affinity",
      rules,
      parent_id: parentSegmentId ?? null,
      depth,
      path,
      branch_dimension: branchDimension ?? null,
      branch_value: branchValue ?? null,
      created_by: userId,
      customer_count: customerIds.length,
    })
    .select()
    .single();

  if (insertErr || !segment) {
    throw new Error(`Failed to create segment: ${insertErr?.message}`);
  }

  // Directly insert customer IDs as segment members (batch in chunks of 500)
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
    const batch = customerIds.slice(i, i + BATCH_SIZE);
    const rows = batch.map((custId) => ({
      org_id: orgId,
      segment_id: segment.id,
      ecom_customer_id: custId,
    }));

    const { error: memberErr } = await supabase
      .from("segment_members")
      .upsert(rows, { onConflict: "org_id,segment_id,ecom_customer_id" });

    if (!memberErr) {
      inserted += batch.length;
    } else {
      console.error(`[segment-direct] Batch insert error: ${memberErr.message}`);
    }
  }

  return {
    success: true,
    message: `Segment "${name}" created successfully!\n` +
      `- **ID:** ${segment.id}\n` +
      `- **Type:** ${segmentType ?? "product_affinity"}\n` +
      `- **Members assigned:** ${inserted} customers (direct)\n` +
      (parentSegmentId ? `- **Parent:** ${parentSegmentId}\n` : "") +
      (branchDimension ? `- **Branch:** ${branchDimension} = ${branchValue}\n` : ""),
  };
}

async function handleListSegments(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const segmentType = input.segment_type as string | undefined;

  try {
    const segments = await getSegmentTree(supabase, orgId);

    if (segments.length === 0) {
      return {
        success: true,
        message: "No segments created yet. Use discover_segments to find natural behavioral clusters, then create_segment to save them.",
      };
    }

    // Filter by type if specified
    const filtered = segmentType
      ? segments.filter((s) => s.segment_type === segmentType)
      : segments;

    const headers = ["Name", "Type", "Customers", "Depth", "Branch", "Status"];
    const rows = filtered.map((s) => [
      "  ".repeat(s.depth) + s.name,
      s.segment_type,
      String(s.customer_count),
      String(s.depth),
      s.branch_dimension ? `${s.branch_dimension}: ${s.branch_value}` : "—",
      s.status,
    ]);

    const tablePayload = {
      title: "Customer Segments",
      headers,
      rows,
      footer: `${filtered.length} active segment${filtered.length !== 1 ? "s" : ""}`,
    };

    return {
      success: true,
      message: `<!--INLINE_TABLE:${JSON.stringify(tablePayload)}-->`,
    };
  } catch (err) {
    return { success: false, message: `Failed to list segments: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleGetSegmentDetails(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const idOrName = input.segment_id_or_name as string;
  const limit = (input.limit as number) ?? 10;

  if (!idOrName) {
    return { success: false, message: "segment_id_or_name is required." };
  }

  try {
    // Try UUID first, then name
    let segmentData: Record<string, unknown> | null = null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(idOrName)) {
      const { data } = await supabase
        .from("segments")
        .select("*")
        .eq("id", idOrName)
        .eq("org_id", orgId)
        .single();
      segmentData = data;
    } else {
      const { data } = await supabase
        .from("segments")
        .select("*")
        .eq("org_id", orgId)
        .ilike("name", `%${idOrName}%`)
        .limit(1)
        .single();
      segmentData = data;
    }

    if (!segmentData) {
      return { success: false, message: `Segment "${idOrName}" not found.` };
    }

    const segmentId = segmentData.id as string;
    const members = await getSegmentMembers(supabase, orgId, segmentId, { limit });

    // Get customer names for the members
    const customerIds = members.map((m) => m.ecom_customer_id);
    const { data: customers } = await supabase
      .from("ecom_customers")
      .select("id, email, first_name, last_name, orders_count, total_spent")
      .in("id", customerIds);

    const customerMap = new Map(
      (customers ?? []).map((c) => [c.id, c])
    );

    let message = `**Segment: ${segmentData.name}**\n`;
    message += `- Type: ${segmentData.segment_type}\n`;
    message += `- Status: ${segmentData.status}\n`;
    message += `- Members: ${segmentData.customer_count}\n`;
    if (segmentData.description) message += `- Description: ${segmentData.description}\n`;
    if (segmentData.branch_dimension) message += `- Branch: ${segmentData.branch_dimension} = ${segmentData.branch_value}\n`;

    if (members.length > 0) {
      const headers = ["Customer", "Email", "Orders", "Spent", "Score", "Lifecycle", "Interval Trend"];
      const rows = members.map((m) => {
        const cust = customerMap.get(m.ecom_customer_id) as Record<string, unknown> | undefined;
        const bd = m.behavioral_data as Record<string, unknown>;
        return [
          cust ? `${cust.first_name} ${cust.last_name}` : "Unknown",
          (cust?.email as string) ?? "—",
          String(cust?.orders_count ?? 0),
          `$${Number(cust?.total_spent ?? 0).toFixed(2)}`,
          String(Math.round(m.score)),
          (bd.lifecycle_stage as string) ?? "—",
          (bd.interval_trend as string) ?? "—",
        ];
      });

      const tablePayload = {
        title: `Top Members: ${segmentData.name}`,
        headers,
        rows,
        footer: `Showing top ${members.length} of ${segmentData.customer_count} members`,
      };

      message += `\n<!--INLINE_TABLE:${JSON.stringify(tablePayload)}-->`;
    }

    return { success: true, message };
  } catch (err) {
    return { success: false, message: `Failed to get segment details: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleGetCustomerBehavioralProfile(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const query = input.email_or_name as string;

  if (!query) {
    return { success: false, message: "email_or_name is required." };
  }

  try {
    const customer = await findCustomerByEmailOrName(supabase, orgId, query);

    if (!customer) {
      return { success: false, message: `Customer "${query}" not found.` };
    }

    const profile = await getCustomerProfile(supabase, orgId, customer.id);

    if (!profile) {
      return {
        success: true,
        message: `Customer found: ${customer.first_name} ${customer.last_name} (${customer.email}), but no behavioral profile computed yet. Use discover_segments first to compute behavioral profiles for all customers.`,
      };
    }

    const affinities = (profile.product_affinities ?? []) as { product_title: string; pct_of_orders: number; purchase_count: number }[];

    let message = `**Behavioral Profile: ${customer.first_name} ${customer.last_name}**\n`;
    message += `- Email: ${customer.email}\n\n`;

    message += `**Purchase Behavior:**\n`;
    message += `- Avg purchase interval: ${profile.avg_interval_days ? profile.avg_interval_days + ' days' : 'N/A'}\n`;
    message += `- Interval trend: ${profile.interval_trend ?? 'N/A'}\n`;
    message += `- Consistency: ${profile.consistency_score ?? 'N/A'}\n`;
    if (profile.predicted_next_purchase) {
      message += `- Predicted next purchase: ${new Date(profile.predicted_next_purchase).toLocaleDateString()}\n`;
      message += `- Days until predicted: ${profile.days_until_predicted}\n`;
    }

    message += `\n**Scores:**\n`;
    message += `- Recency: ${profile.recency_score}/5 | Frequency: ${profile.frequency_score}/5 | Monetary: ${profile.monetary_score}/5\n`;
    message += `- Velocity: ${profile.velocity_score}/5 | Engagement: ${profile.engagement_score}\n`;
    message += `- Lifecycle: ${profile.lifecycle_stage}\n`;
    message += `- Communication style: ${profile.inferred_comm_style}\n`;

    if (affinities.length > 0) {
      message += `\n**Product Affinities:**\n`;
      for (const aff of affinities.slice(0, 5)) {
        message += `- ${aff.product_title}: ${Math.round(aff.pct_of_orders * 100)}% of orders (${aff.purchase_count} purchases)\n`;
      }
    }

    // Show segments this customer belongs to
    const { data: memberships } = await supabase
      .from("segment_members")
      .select("segment_id, score, segments(name)")
      .eq("org_id", orgId)
      .eq("ecom_customer_id", customer.id)
      .order("score", { ascending: false })
      .limit(5);

    if (memberships && memberships.length > 0) {
      message += `\n**Segment Memberships:**\n`;
      for (const m of memberships) {
        const segName = (m.segments as unknown as Record<string, unknown>)?.name ?? "Unknown";
        message += `- ${segName} (score: ${Math.round(m.score as number)})\n`;
      }
    }

    return { success: true, message };
  } catch (err) {
    return { success: false, message: `Failed to get profile: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleDeleteSegment(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  const query = input.segment_id_or_name as string;

  if (!query) {
    return { success: false, message: "segment_id_or_name is required." };
  }

  try {
    // Try to find segment by ID first, then by name
    let segmentId = query;
    let segmentName = query;

    // Check if it's a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);

    if (!isUuid) {
      // Look up by name
      const { data: segments } = await supabase
        .from("segments")
        .select("id, name")
        .eq("org_id", orgId)
        .ilike("name", `%${query}%`)
        .limit(5);

      if (!segments || segments.length === 0) {
        return { success: false, message: `No segment found matching "${query}".` };
      }

      if (segments.length > 1) {
        const list = segments.map((s) => `- ${s.name} (${s.id})`).join("\n");
        return {
          success: false,
          message: `Multiple segments match "${query}". Please specify which one:\n${list}`,
        };
      }

      segmentId = segments[0].id;
      segmentName = segments[0].name;
    }

    // Delete members first, then the segment
    const { error: memberErr } = await supabase
      .from("segment_members")
      .delete()
      .eq("segment_id", segmentId)
      .eq("org_id", orgId);

    if (memberErr) {
      console.error(`[delete_segment] Failed to delete members: ${memberErr.message}`);
    }

    const { error: segErr } = await supabase
      .from("segments")
      .delete()
      .eq("id", segmentId)
      .eq("org_id", orgId);

    if (segErr) {
      return { success: false, message: `Failed to delete segment: ${segErr.message}` };
    }

    return {
      success: true,
      message: `Segment "${segmentName}" and all its members have been deleted.`,
    };
  } catch (err) {
    return { success: false, message: `Failed to delete segment: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

/* ── Email Content Engine handlers ─────────────────────── */

async function handleSaveBrandAsset(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  try {
    const asset = await saveBrandAsset(supabase, orgId, userId, {
      name: input.name as string,
      assetType: (input.asset_type as BrandAssetType) ?? "template",
      contentText: input.content_text as string | undefined,
      contentHtml: input.content_html as string | undefined,
      metadata: input.metadata as Record<string, unknown> | undefined,
    });

    return {
      success: true,
      message: `Brand asset saved: **${asset.name}** (${asset.asset_type})\nID: ${asset.id}\n\nThis will be used as a style reference when generating emails.`,
    };
  } catch (err) {
    return { success: false, message: `Failed to save brand asset: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleListBrandAssets(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  try {
    const assets = await listBrandAssets(supabase, orgId, {
      assetType: input.asset_type as BrandAssetType | undefined,
    });

    if (assets.length === 0) {
      return {
        success: true,
        message: "No brand assets saved yet. Upload email templates, paste example emails, or describe your brand voice to get started. These help the AI match your tone and style when generating emails.",
      };
    }

    const typeIcons: Record<string, string> = {
      template: "📄",
      example: "📧",
      style_guide: "🎨",
      image: "🖼",
      html_template: "🔧",
    };

    const headers = ["Name", "Type", "Content", "Created"];
    const rows = assets.map((a) => [
      a.name,
      `${typeIcons[a.asset_type] ?? ""} ${a.asset_type}`,
      a.content_text ? `${a.content_text.slice(0, 60)}...` : a.content_html ? "HTML template" : "—",
      new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    ]);

    const table = `<!--INLINE_TABLE:${JSON.stringify({ title: `Brand Assets (${assets.length})`, headers, rows })}-->`;

    return { success: true, message: table };
  } catch (err) {
    return { success: false, message: `Failed to list brand assets: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleGenerateEmail(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  try {
    const result = await generateEmailContent(supabase, orgId, userId, {
      prompt: input.prompt as string,
      emailType: (input.email_type as EmailType) ?? "custom",
      segmentId: input.segment_id as string | undefined,
      name: input.name as string | undefined,
      brandAssetIds: input.brand_asset_ids as string[] | undefined,
    });

    let message = `**Email Generated: ${result.name}**\n`;
    message += `**ID:** ${result.id}\n`;
    if (result.segment_name) message += `**Segment:** ${result.segment_name}\n`;
    message += `**Status:** Draft\n\n`;
    message += `**Subject:** ${result.subject_line}\n`;
    message += `**Preview:** ${result.preview_text}\n\n`;

    if (result.personalization_fields.length > 0) {
      message += `**Personalization fields:** ${result.personalization_fields.map((f) => `{{${f}}}`).join(", ")}\n\n`;
    }

    message += `---\n\n`;
    message += result.body_text || "(No plain text version generated)";
    message += `\n\n---\n*Full HTML version saved. Use get_generated_email to retrieve the complete content.*`;

    return { success: true, message };
  } catch (err) {
    return { success: false, message: `Failed to generate email: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleListGeneratedEmails(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  try {
    const emails = await listGeneratedEmails(supabase, orgId, {
      segmentId: input.segment_id as string | undefined,
      status: input.status as string | undefined,
    });

    if (emails.length === 0) {
      return {
        success: true,
        message: "No generated emails yet. Use generate_email to create personalized email content for your segments.",
      };
    }

    const statusIcons: Record<string, string> = {
      draft: "📝",
      approved: "✅",
      sent: "📤",
      archived: "📦",
    };

    const headers = ["Name", "Type", "Subject", "Status", "Created"];
    const rows = emails.map((e) => [
      e.name,
      e.email_type,
      e.subject_line.length > 50 ? e.subject_line.slice(0, 50) + "..." : e.subject_line,
      `${statusIcons[e.status] ?? ""} ${e.status}`,
      new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    ]);

    const table = `<!--INLINE_TABLE:${JSON.stringify({ title: `Generated Emails (${emails.length})`, headers, rows })}-->`;

    return { success: true, message: table };
  } catch (err) {
    return { success: false, message: `Failed to list emails: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

async function handleGetGeneratedEmail(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  try {
    const email = await getGeneratedEmail(supabase, orgId, input.email_id as string);
    if (!email) {
      return { success: false, message: "Email not found." };
    }

    let message = `**${email.name}**\n`;
    message += `**Status:** ${email.status} | **Type:** ${email.email_type}\n`;
    message += `**Subject:** ${email.subject_line}\n`;
    message += `**Preview:** ${email.preview_text || "—"}\n\n`;

    if (email.personalization_fields.length > 0) {
      message += `**Personalization:** ${email.personalization_fields.map((f) => `{{${f}}}`).join(", ")}\n\n`;
    }

    message += `### Plain Text\n${email.body_text || "(none)"}\n\n`;

    if (email.body_html) {
      message += `### HTML Preview\nThe HTML version is ${email.body_html.length} characters. It includes inline styles for email client compatibility.\n`;
    }

    if (email.prompt_used) {
      message += `\n### Generation Prompt\n${email.prompt_used}\n`;
    }

    return { success: true, message };
  } catch (err) {
    return { success: false, message: `Failed to get email: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

/* ═══════════════════════════════════════════════════════════
   KLAVIYO PUSH
   ═══════════════════════════════════════════════════════════ */

async function handlePushSegmentToKlaviyo(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<ToolResult> {
  try {
    const segmentIdOrName = input.segment_id_or_name as string;
    const listNameOverride = input.list_name as string | undefined;

    if (!segmentIdOrName) {
      return { success: false, message: "segment_id_or_name is required." };
    }

    // 1. Resolve segment by ID or name
    let segmentId = segmentIdOrName;
    let segmentName = "";

    // Try UUID first
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(segmentIdOrName)) {
      const { data: seg } = await supabase
        .from("segments")
        .select("id, name")
        .eq("id", segmentIdOrName)
        .eq("org_id", orgId)
        .single();
      if (!seg) return { success: false, message: `Segment not found with ID: ${segmentIdOrName}` };
      segmentId = seg.id as string;
      segmentName = seg.name as string;
    } else {
      // Look up by name (case-insensitive)
      const { data: seg } = await supabase
        .from("segments")
        .select("id, name")
        .eq("org_id", orgId)
        .ilike("name", segmentIdOrName)
        .limit(1)
        .single();
      if (!seg) return { success: false, message: `Segment not found with name: "${segmentIdOrName}"` };
      segmentId = seg.id as string;
      segmentName = seg.name as string;
    }

    // 2. Look up Klaviyo connector
    const { data: connector } = await supabase
      .from("data_connectors")
      .select("config")
      .eq("org_id", orgId)
      .eq("connector_type", "klaviyo")
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connector) {
      return { success: false, message: "Klaviyo is not connected. Please connect Klaviyo first in Data → Connectors." };
    }

    const config = connector.config as unknown as KlaviyoConfig;

    // 3. Push segment to Klaviyo list
    const listName = listNameOverride || segmentName;
    const result = await pushSegmentToList(config, supabase, orgId, segmentId, listName);

    return {
      success: true,
      message: `**Segment Pushed to Klaviyo** ✅\n\n` +
        `- **Segment:** ${segmentName}\n` +
        `- **Klaviyo List:** "${listName}" (ID: ${result.listId})\n` +
        `- **Profiles Added:** ${result.profilesAdded}\n\n` +
        `The segment members are now available in Klaviyo for campaigns and flows.`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to push segment to Klaviyo: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/* ── Campaign Engine Handlers ──────────────────────────── */

async function handleGenerateCampaign(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  try {
    const campaignType = (input.campaign_type as CampaignType) || "per_customer";
    const emailType = (input.email_type as CampaignEmailType) || "custom";
    const deliveryChannel = (input.delivery_channel as DeliveryChannel) || "klaviyo";

    // 1. Create the campaign record
    const campaign = await createCampaign(supabase, orgId, userId, {
      name: input.name as string,
      campaignType,
      segmentId: (input.segment_id as string) || undefined,
      emailType,
      prompt: input.prompt as string,
      templateId: input.template_id as string | undefined,
      deliveryChannel,
    });

    const audienceLabel = campaign.segmentName
      ? `${campaign.segmentName} (${campaign.customerCount} customers)`
      : `All Customers (${campaign.customerCount})`;

    // 2. Generate variants — run inline for small audiences, async for large
    const MAX_INLINE_CUSTOMERS = 50;

    if (campaign.customerCount <= MAX_INLINE_CUSTOMERS) {
      const result = await generateCampaignVariants(supabase, orgId, campaign.campaignId);

      let message = `**Campaign Created & Emails Generated: ${campaign.name}** ✅\n\n`;
      message += `- **ID:** ${campaign.campaignId}\n`;
      message += `- **Type:** ${campaignType === "per_customer" ? "Per-Customer (unique emails)" : "Broadcast (same email)"}\n`;
      message += `- **Audience:** ${audienceLabel}\n`;
      message += `- **Email Type:** ${emailType}\n`;
      message += `- **Delivery Channel:** ${deliveryChannel}\n`;
      message += `- **Variants Generated:** ${result.totalGenerated}\n`;
      message += `- **Status:** ${result.status}\n\n`;

      if (campaignType === "per_customer") {
        message += `Each customer received a unique, AI-generated email tailored to their purchase history, behavioral profile, and communication style.\n\n`;
      }

      // Show a few example subjects
      const { data: sampleVariants } = await supabase
        .from("email_customer_variants")
        .select("customer_name, customer_email, subject_line, preview_text")
        .eq("campaign_id", campaign.campaignId)
        .eq("org_id", orgId)
        .limit(5);

      if (sampleVariants && sampleVariants.length > 0) {
        message += `**Sample emails generated:**\n`;
        for (const v of sampleVariants) {
          message += `- **${v.customer_name || v.customer_email}**: "${v.subject_line}"\n`;
        }
        message += `\n`;
      }

      message += `**Next steps:** Review the generated emails, then use \`send_campaign\` with campaign_id "${campaign.campaignId}" to send them through ${deliveryChannel}.`;

      return { success: true, message };
    } else {
      // Large audience — just create, tell user to trigger generation
      let message = `**Campaign Created: ${campaign.name}** ✅\n\n`;
      message += `- **ID:** ${campaign.campaignId}\n`;
      message += `- **Type:** ${campaignType === "per_customer" ? "Per-Customer (unique emails)" : "Broadcast (same email)"}\n`;
      message += `- **Audience:** ${audienceLabel}\n`;
      message += `- **Email Type:** ${emailType}\n`;
      message += `- **Delivery Channel:** ${deliveryChannel}\n`;
      message += `- **Status:** draft (generation pending)\n\n`;
      message += `This campaign targets ${campaign.customerCount} customers. Email generation will take a few minutes. `;
      message += `Use \`get_campaign_status\` with campaign_id "${campaign.campaignId}" to check progress.`;

      // Kick off generation in background (fire and forget)
      generateCampaignVariants(supabase, orgId, campaign.campaignId).catch((err) => {
        console.error(`[Campaign] Background generation failed for ${campaign.campaignId}:`, err);
      });

      return { success: true, message };
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to generate campaign: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function handleSendCampaign(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  try {
    const campaignId = input.campaign_id as string;
    const confirmed = input.confirmed as boolean;

    if (!campaignId) {
      return { success: false, message: "campaign_id is required." };
    }

    // Get current status first
    const status = await getCampaignStatus(supabase, orgId, campaignId);

    if (!confirmed) {
      // Show summary without sending
      const readyCount = status.approved + status.edited;
      let message = `**Campaign Send Summary: ${status.name}**\n\n`;
      message += `- **Channel:** ${status.deliveryChannel}\n`;
      message += `- **Segment:** ${status.segmentName || "Unknown"}\n`;
      message += `- **Total Variants:** ${status.total}\n`;
      message += `- **Ready to Send:** ${readyCount} (${status.approved} approved, ${status.edited} edited)\n`;
      message += `- **Skipped:** ${status.rejected} rejected, ${status.draft} still in draft\n\n`;

      if (readyCount === 0) {
        message += `⚠️ **No emails are approved for sending.** Please review and approve emails first.`;
      } else {
        message += `To send, call \`send_campaign\` with confirmed=true. Each email will be sent individually through ${status.deliveryChannel}.`;
      }

      return { success: true, message };
    }

    // Actually send
    const result = await sendCampaign(supabase, orgId, campaignId);

    let message = `**Campaign Sent: ${status.name}** ✅\n\n`;
    message += `- **Sent:** ${result.sent} emails through ${status.deliveryChannel}\n`;
    if (result.failed > 0) {
      message += `- **Failed:** ${result.failed} emails\n`;
    }
    message += `- **Status:** ${result.status}\n\n`;
    message += `Use \`get_campaign_status\` to track delivery metrics (opens, clicks, bounces).`;

    return { success: true, message };
  } catch (err) {
    return {
      success: false,
      message: `Failed to send campaign: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function handleCreateSequence(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  try {
    const name = input.name as string;
    const segmentId = input.segment_id as string | undefined;
    const steps = input.steps as Array<{
      delay_days: number;
      email_type: CampaignEmailType;
      prompt: string;
      subject_template?: string;
    }>;
    const deliveryChannel = (input.delivery_channel as DeliveryChannel) || "klaviyo";

    if (!name || !steps || steps.length === 0) {
      return { success: false, message: "name and steps are required." };
    }

    // Validate segment if provided
    let segmentName = "All Customers";
    let customerCount = 0;
    if (segmentId) {
      const { data: segment } = await supabase
        .from("segments")
        .select("id, name, customer_count")
        .eq("id", segmentId)
        .eq("org_id", orgId)
        .single();

      if (!segment) {
        return { success: false, message: `Segment not found: ${segmentId}` };
      }
      segmentName = segment.name as string;
      customerCount = segment.customer_count as number;
    } else {
      const { count } = await supabase
        .from("ecom_customers")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      customerCount = count ?? 0;
    }

    // Resolve delivery config
    const deliveryConfig: Record<string, unknown> = {};
    if (deliveryChannel === "klaviyo") {
      const { data: connector } = await supabase
        .from("data_connectors")
        .select("config")
        .eq("org_id", orgId)
        .eq("connector_type", "klaviyo")
        .eq("status", "connected")
        .maybeSingle();
      if (connector?.config) {
        Object.assign(deliveryConfig, connector.config as Record<string, unknown>);
      }
    }

    // Create the sequence campaign
    const { data: campaign, error: campErr } = await supabase
      .from("email_campaigns")
      .insert({
        org_id: orgId,
        name,
        campaign_type: "sequence" as const,
        segment_id: segmentId ?? null,
        status: "draft",
        email_type: steps[0].email_type || "follow_up",
        prompt_used: steps.map((s, i) => `Step ${i + 1}: ${s.prompt}`).join("\n"),
        delivery_channel: deliveryChannel,
        delivery_config: deliveryConfig,
        created_by: userId,
      })
      .select()
      .single();

    if (campErr || !campaign) {
      throw new Error(`Failed to create sequence: ${campErr?.message}`);
    }

    // Create sequence steps
    const stepRecords = steps.map((s, i) => ({
      org_id: orgId,
      campaign_id: campaign.id as string,
      step_number: i + 1,
      delay_days: s.delay_days,
      email_type: s.email_type || "follow_up",
      prompt: s.prompt,
      subject_template: s.subject_template || null,
      status: "draft" as const,
    }));

    const { error: stepErr } = await supabase
      .from("email_sequence_steps")
      .insert(stepRecords);

    if (stepErr) {
      throw new Error(`Failed to create sequence steps: ${stepErr.message}`);
    }

    let message = `**Email Sequence Created: ${name}** ✅\n\n`;
    message += `- **ID:** ${campaign.id}\n`;
    message += `- **Audience:** ${segmentName} (${customerCount} customers)\n`;
    message += `- **Channel:** ${deliveryChannel}\n`;
    message += `- **Steps:** ${steps.length}\n\n`;

    steps.forEach((s, i) => {
      message += `**Step ${i + 1}** (${s.delay_days === 0 ? "Immediately" : `Day ${s.delay_days}`}): ${s.email_type} — ${s.prompt}\n`;
    });

    message += `\n**Next:** Use \`generate_campaign\` on this campaign to generate the emails for each step.`;

    return { success: true, message };
  } catch (err) {
    return {
      success: false,
      message: `Failed to create sequence: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function handleGetCampaignStatus(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string
): Promise<ToolResult> {
  try {
    const campaignId = input.campaign_id as string;
    if (!campaignId) {
      return { success: false, message: "campaign_id is required." };
    }

    const status = await getCampaignStatus(supabase, orgId, campaignId);

    let message = `**Campaign: ${status.name}**\n\n`;
    message += `- **Type:** ${status.campaignType}\n`;
    message += `- **Status:** ${status.status}\n`;
    message += `- **Email Type:** ${status.emailType}\n`;
    message += `- **Channel:** ${status.deliveryChannel}\n`;
    if (status.segmentName) message += `- **Segment:** ${status.segmentName}\n`;
    message += `\n**Variant Status:**\n`;
    message += `- Total: ${status.total}\n`;
    message += `- Draft: ${status.draft}\n`;
    message += `- Approved: ${status.approved}\n`;
    message += `- Edited: ${status.edited}\n`;
    message += `- Rejected: ${status.rejected}\n`;
    message += `- Sent: ${status.sent}\n`;
    if (status.failed > 0) message += `- Failed: ${status.failed}\n`;

    if (status.deliveryMetrics.delivered > 0 || status.deliveryMetrics.opened > 0) {
      message += `\n**Delivery Metrics:**\n`;
      message += `- Delivered: ${status.deliveryMetrics.delivered}\n`;
      message += `- Opened: ${status.deliveryMetrics.opened} (${status.sent > 0 ? Math.round(status.deliveryMetrics.opened / status.sent * 100) : 0}%)\n`;
      message += `- Clicked: ${status.deliveryMetrics.clicked} (${status.sent > 0 ? Math.round(status.deliveryMetrics.clicked / status.sent * 100) : 0}%)\n`;
      message += `- Bounced: ${status.deliveryMetrics.bounced}\n`;
    }

    return { success: true, message };
  } catch (err) {
    return {
      success: false,
      message: `Failed to get campaign status: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/* ── Plan Campaign Strategy ───────────────────────────── */

async function handlePlanCampaignStrategy(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  try {
    const name = input.name as string;
    const segmentId = input.segment_id as string | undefined;
    const strategyPrompt = input.strategy_prompt as string;

    if (!name || !strategyPrompt) {
      return { success: false, message: "name and strategy_prompt are required." };
    }

    const result = await planCampaignStrategy(supabase, orgId, {
      name,
      segmentId: segmentId || undefined,
      strategyPrompt,
      emailType: (input.email_type as CampaignEmailType) || undefined,
      deliveryChannel: (input.delivery_channel as DeliveryChannel) || undefined,
    }, userId);

    let message = `**Campaign Strategy Created: ${name}** ✅\n\n`;
    message += `- **Campaign ID:** ${result.campaignId}\n`;
    message += `- **Strategy Groups:** ${result.groups.length}\n\n`;

    for (const g of result.groups) {
      message += `### ${g.name} (${g.customerCount} customers, ${g.steps} email${g.steps > 1 ? "s" : ""})\n`;
      message += `${g.reasoning}\n\n`;
    }

    message += `---\n\n**Next steps:** Review the strategy in the **Campaigns** page. You can see each group's journey, member list, and email sequence. When you're happy with the strategy, click "Generate All Emails" to create personalized content for every customer in every group.`;

    return { success: true, message };
  } catch (err) {
    return {
      success: false,
      message: `Failed to plan campaign strategy: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
