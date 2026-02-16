import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { getToolDefinitions } from "./tools";
import { executeTool } from "./tool-executor";
import { hybridSearch, type SearchResult } from "@/lib/embeddings/search";
import { logInBackground, type LLMLogEntry } from "@/lib/logging/llm-logger";

/* ── Types ─────────────────────────────────────────────── */

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  currentPage: string;
  chatFileContents: { name: string; content: string }[];
}

/* ── Truncation helpers ────────────────────────────────── */

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...(truncated)";
}

/* ── System prompt builder ─────────────────────────────── */

function buildSystemPrompt(data: {
  email: string;
  userProfile: Record<string, unknown> | null;
  organization: Record<string, unknown> | null;
  teams: Record<string, unknown>[];
  teamRoles: Record<string, unknown>[];
  teamKpis: Record<string, unknown>[];
  teamTools: Record<string, unknown>[];
  goalSummary: { total: number; byStatus: Record<string, number> };
  painPointSummary: { total: number; byStatus: Record<string, number>; bySeverity: Record<string, number> };
  librarySummary: { items: number; files: number };
  stackTools: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  dashboards: Record<string, unknown>[];
  catalogSummary: { category: string; count: number }[];
  catalogSubcategories: { category: string; subcategory: string; count: number }[];
  chatFileContents: { name: string; content: string }[];
  currentPage: string;
  retrievedContext: SearchResult[];
  crmSummary: {
    contactTotal: number;
    contactByStatus: Record<string, number>;
    companyTotal: number;
    dealTotal: number;
    dealByStage: Record<string, number>;
    pipelineValue: number;
    recentActivities: number;
  };
}): string {
  const {
    email, userProfile, organization,
    teams, teamRoles, teamKpis, teamTools,
    goalSummary, painPointSummary, librarySummary,
    stackTools, projects, dashboards, catalogSummary, catalogSubcategories,
    chatFileContents, currentPage, retrievedContext, crmSummary,
  } = data;

  /* Group team child data by team_id */
  const rolesByTeam: Record<string, typeof teamRoles> = {};
  for (const r of teamRoles) {
    const tid = r.team_id as string;
    if (!rolesByTeam[tid]) rolesByTeam[tid] = [];
    rolesByTeam[tid].push(r);
  }

  const kpisByTeam: Record<string, typeof teamKpis> = {};
  for (const k of teamKpis) {
    const tid = k.team_id as string;
    if (!kpisByTeam[tid]) kpisByTeam[tid] = [];
    kpisByTeam[tid].push(k);
  }

  const toolsByTeam: Record<string, typeof teamTools> = {};
  for (const t of teamTools) {
    const tid = t.team_id as string;
    if (!toolsByTeam[tid]) toolsByTeam[tid] = [];
    toolsByTeam[tid].push(t);
  }

  /* ── Build sections ── */

  const userName = (userProfile?.display_name as string) || email;

  let prompt = `You are an AI business operations copilot for ${userName}'s workspace.

## Your Role
- Help model business processes, team structures, and workflows
- Suggest optimizations based on the user's actual data below
- Help with KPI tracking, goal setting, and tool evaluation
- Be concise and actionable — reference the user's real data when relevant
- When the user is on a specific page, prioritize context about that area
- Format responses with clear structure (use bullet points, headers, etc.)

## Your Capabilities
You can take actions in the user's workspace using tools:
- Update the organization profile (company name, industry, description, stage, target market, differentiators)
- Create teams and add roles, KPIs, and tools to them
- Delete roles, KPIs, and tools from teams
- Create goals and sub-goals, update their status
- Delete goals (and all their sub-goals)
- Create pain points, update their status/severity, and delete them
- Link pain points to existing goals
- Create library items (notes, documents, templates)
- Search the tool catalog for tool details, features, pricing, and comparisons
- Add or remove tools from the user's tech stack
- Compare 2-3 tools side by side from the catalog
- Manage CRM: create/update contacts, companies, deals, and activities
- Search CRM records and get pipeline summaries
- Move deals through pipeline stages (lead → qualified → proposal → negotiation → won/lost)
- Create new projects in the workspace
- Add content to project canvases (text, headings, images, dividers)
- Generate workflow flows from natural language descriptions (process flows, pipelines, automation diagrams)
- Generate workflows from uploaded documents (SOPs, process docs, playbooks, PDFs) — parse the document and extract steps, decisions, and automations into a visual flow

When the user asks you to set something up, create something, delete something, or make changes, use the appropriate tool rather than just describing what they should do manually.
When the user asks to create a workflow, process, flow, or pipeline, use generate_workflow to build it visually with proper nodes and connections. Assign tools from their tech stack to process steps when mentioned.
When the user uploads a document (SOP, process doc, playbook, PDF, etc.) and asks to generate a workflow from it, use generate_workflow_from_document. Parse the document text to identify process steps, decision points, and automation opportunities. Create a comprehensive workflow with proper node types and connections. Include the document text in the document_text parameter so it's recorded.
When the user is on a project page with an existing workflow, you can see all the nodes, connections, roles, tools, durations, and costs. Use this to answer questions about the flow, suggest optimizations, identify bottlenecks, or restructure the workflow when asked. If the user asks you to modify or redo the flow, use generate_workflow — their current version is automatically saved to version history before any AI changes.
If a role, KPI, or tool with the same name already exists on a team, the system will update it instead of creating a duplicate.
The UI updates automatically after changes — no need to tell the user to refresh.
When the user asks about tools, use search_tool_catalog to look up details. When comparing tools, use compare_tools to get full data.

## User's Current Page
${currentPage}
`;

  /* ── User Profile ── */
  if (userProfile) {
    const p = userProfile;
    prompt += `\n## User Profile\n`;
    if (p.display_name) prompt += `**Name:** ${p.display_name}\n`;
    if (p.job_title) prompt += `**Role:** ${p.job_title}\n`;
    if (p.department) prompt += `**Department:** ${p.department}\n`;
    if (p.bio) prompt += `**About:** ${p.bio}\n`;
    if (p.key_responsibilities) prompt += `**Responsibilities:** ${p.key_responsibilities}\n`;
    const expertise = p.areas_of_expertise as string[] | null;
    if (expertise && expertise.length > 0) prompt += `**Expertise:** ${expertise.join(", ")}\n`;
    if (p.years_of_experience) prompt += `**Experience:** ${p.years_of_experience}\n`;
    if (p.focus_areas) prompt += `**Current Priorities:** ${p.focus_areas}\n`;
    if (p.decision_authority) prompt += `**Decision Authority:** ${p.decision_authority}\n`;
    if (p.communication_preferences) prompt += `**Communication Preferences:** ${p.communication_preferences}\n`;
  }

  /* ── Organization ── */
  if (organization) {
    const org = organization;
    prompt += `\n## Organization\n`;
    if (org.name) prompt += `**Company:** ${org.name}\n`;
    if (org.industry) prompt += `**Industry:** ${org.industry}\n`;
    if (org.description) prompt += `**What they sell:** ${org.description}\n`;
    if (org.website) prompt += `**Website:** ${org.website}\n`;
    if (org.stage) prompt += `**Stage:** ${org.stage}\n`;
    if (org.target_market) prompt += `**Target Market/ICP:** ${org.target_market}\n`;
    if (org.differentiators) prompt += `**Differentiators:** ${org.differentiators}\n`;
    if (org.notes) prompt += `**Notes:** ${org.notes}\n`;

    /* Auto-calculate team size from roles */
    const totalHeadcount = teamRoles.reduce(
      (sum, r) => sum + ((r.headcount as number) ?? 0),
      0
    );
    if (totalHeadcount > 0) prompt += `**Team Size:** ${totalHeadcount} people\n`;
  }

  /* ── Teams ── */
  if (teams.length > 0) {
    prompt += `\n## Teams & Organization\n`;
    for (const team of teams) {
      const tid = team.id as string;
      prompt += `\n### ${team.name || team.slug}\n`;
      if (team.description) prompt += `Description: ${team.description}\n`;

      const roles = rolesByTeam[tid] ?? [];
      if (roles.length > 0) {
        prompt += `\nRoles:\n`;
        for (const r of roles) {
          prompt += `- ${r.name} (x${r.headcount ?? 1})`;
          if (r.description) prompt += `: ${r.description}`;
          prompt += `\n`;
        }
      }

      const kpis = kpisByTeam[tid] ?? [];
      if (kpis.length > 0) {
        prompt += `\nKPIs:\n`;
        for (const k of kpis) {
          prompt += `- ${k.name}: ${k.current_value ?? "?"} / ${k.target_value ?? "?"} per ${k.period}\n`;
        }
      }

      const tools = toolsByTeam[tid] ?? [];
      if (tools.length > 0) {
        prompt += `\nTools:\n`;
        for (const t of tools) {
          prompt += `- ${t.name}`;
          if (t.purpose) prompt += `: ${t.purpose}`;
          prompt += `\n`;
        }
      }
    }
  }

  /* ── Goals summary (counts only — details come from RAG) ── */
  if (goalSummary.total > 0) {
    prompt += `\n## Goals Summary\n`;
    prompt += `Total: ${goalSummary.total} goals\n`;
    const statuses = Object.entries(goalSummary.byStatus)
      .map(([s, c]) => `${s}: ${c}`)
      .join(", ");
    if (statuses) prompt += `By status: ${statuses}\n`;
    prompt += `(Detailed goal content is retrieved via semantic search when relevant to your question)\n`;
  }

  /* ── Pain Points summary (counts only — details come from RAG) ── */
  if (painPointSummary.total > 0) {
    prompt += `\n## Pain Points Summary\n`;
    prompt += `Total: ${painPointSummary.total} pain points\n`;
    const statuses = Object.entries(painPointSummary.byStatus)
      .map(([s, c]) => `${s}: ${c}`)
      .join(", ");
    if (statuses) prompt += `By status: ${statuses}\n`;
    const severities = Object.entries(painPointSummary.bySeverity)
      .map(([s, c]) => `${s}: ${c}`)
      .join(", ");
    if (severities) prompt += `By severity: ${severities}\n`;
    prompt += `(Detailed pain point content is retrieved via semantic search when relevant to your question)\n`;
  }

  /* ── Library summary (counts only — details come from RAG) ── */
  if (librarySummary.items > 0 || librarySummary.files > 0) {
    prompt += `\n## Library Summary\n`;
    if (librarySummary.items > 0) prompt += `Notes & Documents: ${librarySummary.items}\n`;
    if (librarySummary.files > 0) prompt += `Files: ${librarySummary.files}\n`;
    prompt += `(Detailed library content is retrieved via semantic search when relevant to your question)\n`;
  }

  /* ── CRM Summary ── */
  if (crmSummary.contactTotal > 0 || crmSummary.companyTotal > 0 || crmSummary.dealTotal > 0) {
    prompt += `\n## CRM Summary\n`;
    if (crmSummary.contactTotal > 0) {
      prompt += `**Contacts:** ${crmSummary.contactTotal} — ${Object.entries(crmSummary.contactByStatus).map(([s, n]) => `${n} ${s}`).join(", ")}\n`;
    }
    if (crmSummary.companyTotal > 0) prompt += `**Companies:** ${crmSummary.companyTotal}\n`;
    if (crmSummary.dealTotal > 0) {
      prompt += `**Deals:** ${crmSummary.dealTotal} — ${Object.entries(crmSummary.dealByStage).map(([s, n]) => `${n} ${s}`).join(", ")}\n`;
      prompt += `**Pipeline Value:** $${crmSummary.pipelineValue.toLocaleString()}\n`;
    }
    if (crmSummary.recentActivities > 0) prompt += `**Activities (last 7 days):** ${crmSummary.recentActivities}\n`;
  }

  /* ── Tech Stack ── */
  if (stackTools.length > 0) {
    prompt += `\n## User's Tech Stack\n`;
    for (const t of stackTools) {
      prompt += `- **${t.name}** (${t.category || "Uncategorized"}) [${t.status}]`;
      const stackTeams = t.teams as string[] | null;
      if (stackTeams && stackTeams.length > 0) prompt += ` — Teams: ${stackTeams.join(", ")}`;
      if (t.description) prompt += `\n  ${truncate(t.description as string, 200)}`;
      const usage = t.team_usage as Record<string, string> | null;
      if (usage && Object.keys(usage).length > 0) {
        for (const [team, desc] of Object.entries(usage)) {
          prompt += `\n  ${team}: ${desc}`;
        }
      }
      prompt += `\n`;
    }
  }

  /* ── Tool Catalog summary (for context — use search_tool_catalog for details) ── */
  if (catalogSummary.length > 0) {
    const totalCatalog = catalogSummary.reduce((sum, c) => sum + c.count, 0);
    prompt += `\n## Tool Catalog\n`;
    prompt += `You have access to a catalog of ${totalCatalog} tools. Use the search_tool_catalog tool to look up details about specific tools.\n`;
    prompt += `Categories: ${catalogSummary.map((c) => `${c.category} (${c.count})`).join(", ")}\n`;

    /* Show subcategories so AI knows what to search for */
    if (catalogSubcategories.length > 0) {
      prompt += `\nSubcategories by category:\n`;
      const byCat: Record<string, string[]> = {};
      for (const s of catalogSubcategories) {
        if (!byCat[s.category]) byCat[s.category] = [];
        byCat[s.category].push(`${s.subcategory} (${s.count})`);
      }
      for (const [cat, subs] of Object.entries(byCat)) {
        prompt += `- ${cat}: ${subs.join(", ")}\n`;
      }
    }

    prompt += `\nWhen searching the catalog, use subcategory names or keywords for best results. For example: "AI SDR", "CRM", "Email Marketing", "LLM Provider".\n`;
  }

  /* ── Dashboards ── */
  if (dashboards.length > 0) {
    prompt += `\n## Dashboards\n`;
    for (const d of dashboards) {
      const widgets = d.widgets as unknown[];
      const widgetCount = widgets?.length ?? 0;
      prompt += `- **${d.name}** (${widgetCount} widget${widgetCount !== 1 ? "s" : ""})\n`;
    }
  }

  /* ── Projects ── */
  if (projects.length > 0) {
    prompt += `\n## Projects\n`;
    for (const p of projects) {
      const blocks = p.canvas_blocks as unknown[];
      const blockCount = blocks?.length ?? 0;
      prompt += `- **${p.name}** (mode: ${p.active_mode}, ${blockCount} canvas block${blockCount !== 1 ? "s" : ""}) — /projects/${p.slug}\n`;
      if (p.description) prompt += `  ${truncate(p.description as string, 200)}\n`;

      /* Include workflow details for the project the user is currently viewing */
      const wfNodes = p.workflow_nodes as unknown[];
      if (wfNodes?.length > 0 && currentPage.includes(`/projects/${p.slug}`)) {
        const wf = wfNodes[0] as { nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[] };
        if (wf.nodes && wf.nodes.length > 0) {
          prompt += `\n  **Current Workflow (${wf.nodes.length} nodes, ${wf.edges?.length ?? 0} edges):**\n`;
          for (const node of wf.nodes) {
            const props = node.properties as Record<string, string> | undefined;
            prompt += `  - [${node.type}] "${node.title}"`;
            if (node.description) prompt += ` — ${truncate(node.description as string, 100)}`;
            if (props?.role_name) prompt += ` (Role: ${props.role_name}${props.role_team ? ` / ${props.role_team}` : ""})`;
            if (props?.tool_name) prompt += ` [Tool: ${props.tool_name}]`;
            if (props?.model) prompt += ` [Model: ${props.model}]`;
            if (props?.duration) prompt += ` ~${props.duration}min`;
            if (props?.cost) prompt += ` $${props.cost}`;
            prompt += `\n`;
          }
          if (wf.edges && wf.edges.length > 0) {
            prompt += `  Connections:\n`;
            for (const edge of wf.edges) {
              const srcNode = wf.nodes.find(n => n.id === edge.sourceNodeId);
              const tgtNode = wf.nodes.find(n => n.id === edge.targetNodeId);
              if (srcNode && tgtNode) {
                prompt += `  - "${srcNode.title}" → "${tgtNode.title}"`;
                if (edge.label) prompt += ` [${edge.label}]`;
                prompt += `\n`;
              }
            }
          }
        }
      }
    }
  }

  /* ── Session files ── */
  if (chatFileContents.length > 0) {
    prompt += `\n## Session Files (uploaded for this conversation)\n`;
    for (const f of chatFileContents) {
      prompt += `\n### ${f.name}\n${truncate(f.content, 3000)}\n`;
    }
  }

  /* ── Retrieved Context (RAG) ── */
  if (retrievedContext.length > 0) {
    prompt += `\n## Relevant Context (retrieved via semantic search)\n`;
    prompt += `The following content was retrieved because it's most relevant to the user's current question.\n`;

    /* Group by source table for readability */
    const byTable = new Map<string, SearchResult[]>();
    for (const r of retrievedContext) {
      if (!byTable.has(r.sourceTable)) byTable.set(r.sourceTable, []);
      byTable.get(r.sourceTable)!.push(r);
    }

    const tableLabels: Record<string, string> = {
      goals: "Goals",
      sub_goals: "Sub-Goals",
      pain_points: "Pain Points",
      library_items: "Library Items",
      library_files: "Library Files",
      organization_files: "Organization Documents",
      team_files: "Team Documents",
    };

    for (const [table, results] of byTable) {
      const label = tableLabels[table] ?? table;
      prompt += `\n### ${label}\n`;
      for (const r of results) {
        const meta = r.metadata ?? {};
        const name = (meta.name ?? meta.title ?? "") as string;
        const status = meta.status ? ` [${meta.status}]` : "";
        const severity = meta.severity ? ` (${meta.severity})` : "";

        if (name) {
          prompt += `**${name}**${status}${severity}\n`;
        }
        prompt += `${truncate(r.chunkText, 800)}\n\n`;
      }
    }
  }

  return prompt;
}

/* ── POST handler ──────────────────────────────────────── */

export async function POST(req: Request) {
  const requestStart = Date.now();

  /* 1. Check API key */
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
  }

  /* 2. Auth */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  /* 3. Parse request */
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { messages, currentPage, chatFileContents } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response("Messages array is required", { status: 400 });
  }

  /* 4. RAG: Embed user's last message and retrieve relevant chunks */
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let retrievedContext: SearchResult[] = [];
  let retrievedChunkIds: string[] = [];

  // Only do RAG search if OPENAI_API_KEY is available (embeddings need it)
  if (process.env.OPENAI_API_KEY && lastUserMessage.trim()) {
    try {
      retrievedContext = await hybridSearch(supabase, user.id, lastUserMessage, {
        limit: 10,
      });
      retrievedChunkIds = retrievedContext.map((r) => r.id);
    } catch (err) {
      // RAG failure is non-fatal — proceed without context
      console.error("RAG search failed:", err);
    }
  }

  /* 5. Load user data in parallel — lean queries for RAG-covered tables */
  const [
    { data: userProfile },
    { data: organization },
    { data: teams },
    { data: teamRoles },
    { data: teamKpis },
    { data: teamTools },
    { data: goals },
    { data: painPoints },
    { data: libraryItemCount },
    { data: libraryFileCount },
    { data: stackTools },
    { data: catalogCategories },
    { data: projects },
    { data: dashboardsData },
    // CRM lean queries
    { data: crmContacts },
    { data: crmCompanies },
    { data: crmDeals },
    { data: crmRecentActivities },
  ] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("organizations").select("*").eq("user_id", user.id).single(),
    supabase.from("teams").select("*").order("created_at"),
    supabase.from("team_roles").select("*").order("created_at"),
    supabase.from("team_kpis").select("*").order("created_at"),
    supabase.from("team_tools").select("*").order("created_at"),
    // Lean queries: only status for summary counts
    supabase.from("goals").select("status"),
    supabase.from("pain_points").select("status, severity"),
    supabase.from("library_items").select("id", { count: "exact", head: true }),
    supabase.from("library_files").select("id", { count: "exact", head: true }),
    supabase.from("user_stack_tools").select("*").order("created_at", { ascending: false }),
    supabase.from("tool_catalog").select("category, subcategory"),
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("dashboards").select("id, name, widgets").eq("user_id", user.id).order("created_at"),
    // CRM
    supabase.from("crm_contacts").select("status"),
    supabase.from("crm_companies").select("id", { count: "exact", head: true }),
    supabase.from("crm_deals").select("stage, value"),
    supabase.from("crm_activities").select("type").gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  /* Build goal summary */
  const goalStatusCounts: Record<string, number> = {};
  for (const g of goals ?? []) {
    const s = (g.status as string) || "Backlog";
    goalStatusCounts[s] = (goalStatusCounts[s] ?? 0) + 1;
  }
  const goalSummary = {
    total: goals?.length ?? 0,
    byStatus: goalStatusCounts,
  };

  /* Build pain point summary */
  const ppStatusCounts: Record<string, number> = {};
  const ppSeverityCounts: Record<string, number> = {};
  for (const pp of painPoints ?? []) {
    const s = (pp.status as string) || "Backlog";
    ppStatusCounts[s] = (ppStatusCounts[s] ?? 0) + 1;
    const sev = (pp.severity as string) || "Medium";
    ppSeverityCounts[sev] = (ppSeverityCounts[sev] ?? 0) + 1;
  }
  const painPointSummary = {
    total: painPoints?.length ?? 0,
    byStatus: ppStatusCounts,
    bySeverity: ppSeverityCounts,
  };

  /* Library summary */
  const librarySummary = {
    items: libraryItemCount?.length ?? 0,
    files: libraryFileCount?.length ?? 0,
  };

  /* Build catalog category summary */
  const catCounts: Record<string, number> = {};
  const subCounts: Record<string, Record<string, number>> = {};
  for (const row of catalogCategories ?? []) {
    const cat = (row.category as string) || "Uncategorized";
    const sub = (row.subcategory as string) || "";
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    if (sub) {
      if (!subCounts[cat]) subCounts[cat] = {};
      subCounts[cat][sub] = (subCounts[cat][sub] ?? 0) + 1;
    }
  }
  const catalogSummary = Object.entries(catCounts).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  const catalogSubcategories: { category: string; subcategory: string; count: number }[] = [];
  for (const [cat, subs] of Object.entries(subCounts)) {
    for (const [sub, count] of Object.entries(subs)) {
      catalogSubcategories.push({ category: cat, subcategory: sub, count });
    }
  }
  catalogSubcategories.sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count);

  /* CRM summary */
  const crmContactStatusCounts: Record<string, number> = {};
  for (const c of crmContacts ?? []) {
    const s = (c.status as string) || "lead";
    crmContactStatusCounts[s] = (crmContactStatusCounts[s] ?? 0) + 1;
  }
  const crmDealStageCounts: Record<string, number> = {};
  let crmPipelineValue = 0;
  for (const d of crmDeals ?? []) {
    const s = (d.stage as string) || "lead";
    crmDealStageCounts[s] = (crmDealStageCounts[s] ?? 0) + 1;
    if (s !== "lost") crmPipelineValue += Number(d.value ?? 0);
  }
  const crmSummary = {
    contactTotal: crmContacts?.length ?? 0,
    contactByStatus: crmContactStatusCounts,
    companyTotal: crmCompanies?.length ?? 0,
    dealTotal: crmDeals?.length ?? 0,
    dealByStage: crmDealStageCounts,
    pipelineValue: crmPipelineValue,
    recentActivities: crmRecentActivities?.length ?? 0,
  };

  /* 6. Build system prompt */
  const systemPrompt = buildSystemPrompt({
    email: user.email ?? "User",
    userProfile: userProfile ?? null,
    organization: organization ?? null,
    teams: teams ?? [],
    teamRoles: teamRoles ?? [],
    teamKpis: teamKpis ?? [],
    teamTools: teamTools ?? [],
    goalSummary,
    painPointSummary,
    librarySummary,
    stackTools: stackTools ?? [],
    projects: projects ?? [],
    dashboards: dashboardsData ?? [],
    catalogSummary,
    catalogSubcategories,
    chatFileContents: chatFileContents ?? [],
    currentPage: currentPage ?? "/",
    retrievedContext,
    crmSummary,
  });

  /* 7. Call Claude with streaming + tool use */
  const anthropic = new Anthropic();
  const tools = getToolDefinitions();
  const encoder = new TextEncoder();

  // Tracking for LLM logging
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolRounds = 0;
  const allToolCalls: { name: string; success: boolean }[] = [];
  let stopReason: string | null = null;
  let logError: string | null = null;

  try {
    const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const readable = new ReadableStream({
      async start(controller) {
        try {
          /* ── First API call (may trigger tool use) ── */
          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages: apiMessages,
            tools,
          });

          /* Stream any text from the first call */
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          /* Check if Claude wants to use tools — support up to 5 rounds */
          let currentMessage = await stream.finalMessage();
          let currentMessages = [...apiMessages];

          // Accumulate token usage
          totalInputTokens += currentMessage.usage?.input_tokens ?? 0;
          totalOutputTokens += currentMessage.usage?.output_tokens ?? 0;
          stopReason = currentMessage.stop_reason;

          const MAX_TOOL_ROUNDS = 5;

          while (currentMessage.stop_reason === "tool_use" && toolRounds < MAX_TOOL_ROUNDS) {
            toolRounds++;

            /* Extract tool_use blocks */
            const toolUseBlocks = currentMessage.content.filter(
              (block): block is Anthropic.Messages.ToolUseBlock =>
                block.type === "tool_use"
            );

            /* Execute all tools */
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const toolBlock of toolUseBlocks) {
              const result = await executeTool(
                toolBlock.name,
                toolBlock.input as Record<string, unknown>,
                supabase,
                user.id
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: result.message,
                is_error: !result.success,
              });
              allToolCalls.push({
                name: toolBlock.name,
                success: result.success,
              });
            }

            /* Build messages with tool results */
            currentMessages = [
              ...currentMessages,
              { role: "assistant" as const, content: currentMessage.content },
              { role: "user" as const, content: toolResults },
            ];

            /* Next API call with tool results */
            const nextStream = anthropic.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              system: systemPrompt,
              messages: currentMessages,
              tools,
            });

            /* Stream any text from this round */
            for await (const event of nextStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            }

            currentMessage = await nextStream.finalMessage();

            // Accumulate token usage from this round
            totalInputTokens += currentMessage.usage?.input_tokens ?? 0;
            totalOutputTokens += currentMessage.usage?.output_tokens ?? 0;
            stopReason = currentMessage.stop_reason;
          }

          controller.close();
        } catch (err) {
          logError = err instanceof Error ? err.message : "Stream error";
          controller.error(err);
        } finally {
          /* ── Log the LLM call (fire-and-forget) ── */
          const latencyMs = Date.now() - requestStart;
          const logEntry: LLMLogEntry = {
            userId: user.id,
            model: "claude-sonnet-4-20250514",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            latencyMs,
            retrievedChunkIds,
            toolCalls: allToolCalls,
            toolRounds,
            userMessage: lastUserMessage,
            stopReason: stopReason ?? undefined,
            error: logError ?? undefined,
          };
          logInBackground(supabase, logEntry);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude API error";
    return new Response(message, { status: 502 });
  }
}
