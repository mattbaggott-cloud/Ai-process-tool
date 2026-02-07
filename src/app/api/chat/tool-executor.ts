import { SupabaseClient } from "@supabase/supabase-js";

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
  userId: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "create_team":
        return await handleCreateTeam(input, supabase, userId);
      case "add_team_roles":
        return await handleAddTeamRoles(input, supabase);
      case "add_team_kpis":
        return await handleAddTeamKpis(input, supabase);
      case "add_team_tools":
        return await handleAddTeamTools(input, supabase, userId);
      case "update_team_description":
        return await handleUpdateTeamDescription(input, supabase);
      case "create_goal":
        return await handleCreateGoal(input, supabase, userId);
      case "add_sub_goals":
        return await handleAddSubGoals(input, supabase, userId);
      case "update_goal_status":
        return await handleUpdateGoalStatus(input, supabase);
      case "create_library_item":
        return await handleCreateLibraryItem(input, supabase, userId);
      case "delete_team_roles":
        return await handleDeleteTeamRoles(input, supabase);
      case "delete_team_kpis":
        return await handleDeleteTeamKpis(input, supabase);
      case "delete_team_tools":
        return await handleDeleteTeamTools(input, supabase);
      case "delete_goal":
        return await handleDeleteGoal(input, supabase);
      case "update_organization":
        return await handleUpdateOrganization(input, supabase, userId);
      case "search_tool_catalog":
        return await handleSearchToolCatalog(input, supabase);
      case "add_stack_tool":
        return await handleAddStackTool(input, supabase, userId);
      case "remove_stack_tool":
        return await handleRemoveStackTool(input, supabase);
      case "compare_tools":
        return await handleCompareTools(input, supabase);
      case "create_project":
        return await handleCreateProject(input, supabase, userId);
      case "update_canvas":
        return await handleUpdateCanvas(input, supabase);
      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Tool execution failed: ${msg}` };
  }
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
  userId: string
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
    .insert({ user_id: userId, slug, name, description })
    .select()
    .single();

  if (error) return { success: false, message: `Failed to create team: ${error.message}` };
  return { success: true, message: `Created team "${data.name}" with slug "${data.slug}"` };
}

async function handleAddTeamRoles(
  input: Record<string, unknown>,
  supabase: SupabaseClient
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
  supabase: SupabaseClient
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
  userId: string
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
  userId: string
): Promise<ToolResult> {
  const name = input.name as string;
  if (!name) return { success: false, message: "Goal name is required" };

  const row = {
    user_id: userId,
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
  return { success: true, message: `Created goal "${data.name}" with status "${data.status}"` };
}

async function handleAddSubGoals(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string
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
    name: s.name,
    description: s.description ?? "",
    status: s.status ?? "Backlog",
    owner: s.owner ?? "",
    end_date: s.end_date ?? null,
  }));

  const { error } = await supabase.from("sub_goals").insert(rows);
  if (error) return { success: false, message: `Failed to add sub-goals: ${error.message}` };

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
    return { success: true, message: `Updated goal "${goalName}" to "${status}"` };
  }
}

/* ══════════════════════════════════════════════════════════
   LIBRARY HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleCreateLibraryItem(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string
): Promise<ToolResult> {
  const title = input.title as string;
  const content = input.content as string;

  if (!title || !content) {
    return { success: false, message: "title and content are required" };
  }

  const row = {
    user_id: userId,
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

  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  if (error) return { success: false, message: `Failed to delete goal: ${error.message}` };
  return { success: true, message: `Deleted goal "${goalName}" and all its sub-goals` };
}

/* ══════════════════════════════════════════════════════════
   ORGANIZATION HANDLERS
   ══════════════════════════════════════════════════════════ */

async function handleUpdateOrganization(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string
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
    .from("organizations")
    .upsert(
      { user_id: userId, ...updates },
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
  userId: string
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
  userId: string
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

  /* Generate IDs for new blocks */
  const newBlocks = blocks.map((b) => ({
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    type: b.type,
    ...(b.content !== undefined && { content: b.content }),
    ...(b.level !== undefined && { level: b.level }),
    ...(b.url !== undefined && { url: b.url }),
    ...(b.alt !== undefined && { alt: b.alt }),
  }));

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
