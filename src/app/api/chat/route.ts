import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { getToolDefinitions } from "./tools";
import { executeAction } from "@/lib/agentic/action-executor";
import { hybridSearch, type SearchResult } from "@/lib/embeddings/search";
import { logInBackground, type LLMLogEntry } from "@/lib/logging/llm-logger";
import { getOrgContext } from "@/lib/org";
import { retrieveMemories, formatMemoriesForPrompt } from "@/lib/agentic/memory-retriever";
import { extractAndStoreMemoriesInBackground } from "@/lib/agentic/memory-extractor";
import { getGraphContext } from "@/lib/agentic/graph-query";
import { getIdentityStats } from "@/lib/shopify/identity-linker";

/* ── Types ─────────────────────────────────────────────── */

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  currentPage: string;
  chatFileContents: { name: string; content: string }[];
  activeReport?: Record<string, unknown> | null;
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
    reportCount: number;
  };
  activeReport: Record<string, unknown> | null;
  orgRole: string;
  orgMemberCount: number;
  orgMembersByRole: Record<string, number>;
  orgDepartmentNames: string[];
  pendingInviteCount: number;
  ecomSummary: {
    customerCount: number;
    orderCount: number;
    productCount: number;
    shopifyConnected: boolean;
    lastSyncAt: string | null;
  };
  identityStats: {
    total_crm_contacts: number;
    total_ecom_customers: number;
    linked: number;
    crm_only: number;
    ecom_only: number;
  } | null;
  memorySummary: string;
  graphContext: string;
}): string {
  const {
    email, userProfile, organization,
    teams, teamRoles, teamKpis, teamTools,
    goalSummary, painPointSummary, librarySummary,
    stackTools, projects, dashboards, catalogSummary, catalogSubcategories,
    chatFileContents, currentPage, retrievedContext, crmSummary, activeReport,
    orgRole, orgMemberCount, orgMembersByRole, orgDepartmentNames, pendingInviteCount,
    ecomSummary, identityStats, memorySummary, graphContext,
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

  let prompt = `You are an intelligent AI agent operating ${userName}'s business workspace. You are NOT a software feature — you are a reasoning agent that understands context, remembers preferences, and takes smart action.

## Your Identity
- You THINK before acting. You interpret what the user means, not just what they literally said.
- You REMEMBER. When a user tells you a preference (like "I prefer EUR"), you acknowledge it and apply it immediately and in all future interactions. You don't tell them to go change settings — YOU are the settings.
- You REASON across data. If deal values are stored in USD but the user prefers EUR, you convert and display in EUR. If a user asks about patterns across customers, you analyze and find them.
- You are concise, actionable, and reference the user's real data.
- Format responses with clear structure (bullet points, headers, etc.)
- When the user is on a specific page, prioritize context about that area.

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
- Manage organization members: invite new members, list current members, change roles, remove members
- Create departments to organize the team
- View organization info: member count, departments, pending invites
- **E-Commerce Analytics:** Run deep analytics on Shopify data — revenue trends, AOV over time, customer LTV rankings, repeat purchase rates, top products by revenue/quantity, customer cohort analysis, and RFM segmentation
- **Rich Inline Content:** Render data tables and charts directly in chat responses for visual, actionable insights

## When to Clarify vs. Just Act
Most requests are clear — just execute them. Only ask for clarification when the request has genuine ambiguity that could lead to wrong results.

**Clear requests — act immediately, no questions:**
- "Show me leads with phone numbers" → Create report: status=Lead + phone is_not_empty. Done.
- "Create a contact named John Smith, john@test.com" → Just create it.
- "Delete the Acme deal" → Just do it (if there's only one Acme deal).

**Ambiguous requests — clarify first:**
- "Show me active leads with phone email" → Ambiguous: does "active leads" mean two statuses (Active + Lead) or just leads that are active? Does "phone email" mean has both, or show those columns? Ask.
- "Update the deal" → Which deal? What changes?
- "Delete old activities" → How old?
- "Show me big deals" → What threshold is "big"?

**The rule:** If the request reads like a clear sentence with obvious meaning, act. If it's a run-on, has missing punctuation, mixes terms that could mean different things, or uses vague words like "big", "old", "recent" without specifics — clarify.

**Report filter rules:** When a user says "with [field]" (e.g. "with phone numbers"), ALWAYS add an is_not_empty filter for that field — "with" means the data must exist. When multiple statuses or values apply to the same field, use separate equality filters (the system ORs them). Always match your filters to exactly what the user asked for.

When the user asks you to set something up, create something, delete something, or make changes, use the appropriate tool rather than just describing what they should do manually.
When the user asks to create a workflow, process, flow, or pipeline, use generate_workflow to build it visually with proper nodes and connections. Assign tools from their tech stack to process steps when mentioned.
When the user uploads a document (SOP, process doc, playbook, PDF, etc.) and asks to generate a workflow from it, use generate_workflow_from_document. Parse the document text to identify process steps, decision points, and automation opportunities. Create a comprehensive workflow with proper node types and connections. Include the document text in the document_text parameter so it's recorded.
When the user is on a project page with an existing workflow, you can see all the nodes, connections, roles, tools, durations, and costs. Use this to answer questions about the flow, suggest optimizations, identify bottlenecks, or restructure the workflow when asked. If the user asks you to modify or redo the flow, use generate_workflow — their current version is automatically saved to version history before any AI changes.
If a role, KPI, or tool with the same name already exists on a team, the system will update it instead of creating a duplicate.
The UI updates automatically after changes — no need to tell the user to refresh.
When the user asks about tools, use search_tool_catalog to look up details. When comparing tools, use compare_tools to get full data.
When the user asks to invite someone, add a team member, or manage roles, use the org management tools (invite_member, update_member_role, remove_member, list_members).
For invite_member, update_member_role, and remove_member: ALWAYS call with confirmed=false first, present the summary to the user, and only call again with confirmed=true after the user explicitly confirms. Never skip the confirmation step.
Invite permission hierarchy: Owner invites anyone. Admin invites manager/user/viewer. Manager invites user/viewer. User and Viewer cannot invite.

## E-Commerce Intelligence
When the user asks about e-commerce metrics, analytics, or business performance, use the query_ecommerce_analytics tool. Choose the right metric:
- "Show me revenue" / "How are sales trending?" → metric: revenue (use compare_previous: true if they ask for comparisons)
- "What's my average order value?" / "AOV trends" → metric: aov
- "Who are my best customers?" / "Customer lifetime value" → metric: ltv
- "What's my repeat purchase rate?" / "How many customers reorder?" → metric: repeat_rate
- "What are my top products?" / "Best sellers" → metric: top_products (supports sort_by: "revenue" | "quantity" | "orders")
- "Show me customer cohorts" / "When did customers first buy?" → metric: cohort
- "Segment my customers" / "RFM analysis" → metric: rfm

**CRITICAL EFFICIENCY RULES — READ CAREFULLY:**
1. **query_ecommerce_analytics is your ONLY analytics tool.** NEVER query ecom_orders, ecom_products, or ecom_customers tables directly to compute metrics. The analytics tool handles all aggregation via optimized database functions.
2. **For multi-metric questions, call query_ecommerce_analytics MULTIPLE TIMES in the SAME tool round** (parallel tool calls). For example, if asked "give me a full business overview", call revenue + repeat_rate + top_products + rfm ALL AT ONCE — not one per round.
3. **NEVER use query_ecommerce (raw table queries) for analytics.** query_ecommerce is ONLY for looking up specific customer records, searching by name/email, or listing recent orders. If you need aggregated numbers (revenue, AOV, top products, cohort, RFM, repeat rate), ALWAYS use query_ecommerce_analytics.
4. **You have a maximum of 5 tool rounds.** Plan efficiently. A "full business health" question should take 1-2 rounds, not 5+. Gather all metrics in parallel on the first round, then present results.
5. **NEVER say "let me try a different approach" and re-query.** If a tool returns data, use it. Don't second-guess and re-query the same data differently.

**Cross-Source Data Rules:**
When comparing people/contacts across HubSpot and Shopify, ALWAYS use the identity resolution stats provided in the "Customer Identity Resolution" section below. NEVER estimate or guess at overlap between systems — the exact numbers are provided. For detailed cross-source queries, use query_ecommerce with entity_type "unified".

For presenting data visually, use create_inline_chart and create_inline_table tools. These render rich content (charts and tables) directly in the chat. Always prefer visual presentation over walls of text:
- Use create_inline_chart for trends, comparisons, and distributions
- Use create_inline_table for ranked lists, detailed breakdowns, and structured data
- The query_ecommerce_analytics tool automatically embeds charts and tables, but you can also create them manually when combining data from multiple sources or presenting CRM + ecommerce data together

**CRITICAL — Inline Rendering Rules:**
When a tool result contains \`<!--INLINE_CHART:...-->\` or \`<!--INLINE_TABLE:...-->\` markers, you MUST include them **exactly as-is** in your response text. These are special rendering directives that the frontend uses to display charts and tables visually. Do NOT strip, summarize, or paraphrase these markers. Copy them verbatim into your response, then add your analysis text around them. Example flow:
1. Tool returns: \`<!--INLINE_CHART:{"chart_type":"bar",...}-->\`
2. Your response: "Here's your revenue breakdown:\\n\\n<!--INLINE_CHART:{"chart_type":"bar",...}-->\\n\\nKey observations: ..."
Never describe the data in text when a chart/table marker is available — let the visual render and add insights alongside it.

## User's Current Page
${currentPage}
`;

  /* ── Memory Context ── */
  if (memorySummary) {
    prompt += "\n" + memorySummary + "\n";
  }

  /* ── Graph Context (Knowledge Graph) ── */
  if (graphContext) {
    prompt += "\n" + graphContext + "\n";
  }

  /* ── Active Report Context ── */
  if (activeReport) {
    prompt += `\n## Currently Viewing Report\n`;
    prompt += `The user is currently viewing a report. When they ask to modify columns, filters, or settings, use the update_report tool with this report's ID instead of creating a new report.\n`;
    prompt += `**Report ID:** ${activeReport.id}\n`;
    prompt += `**Name:** ${activeReport.name}\n`;
    prompt += `**Entity Type:** ${activeReport.entity_type}\n`;
    prompt += `**Current Columns:** ${(activeReport.columns as string[])?.join(", ") || "default"}\n`;
    if ((activeReport.filters as unknown[])?.length > 0) {
      prompt += `**Filters:** ${JSON.stringify(activeReport.filters)}\n`;
    }
    prompt += `**Results:** ${activeReport.resultCount ?? "unknown"} records\n`;
  }

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

  /* ── User's Org Role & Permissions ── */
  if (orgRole) {
    prompt += `\n## Your Organization Role\n`;
    prompt += `**Your role:** ${orgRole}\n`;
    prompt += `**Can invite members:** ${
      orgRole === "owner" ? "Yes (any role)" :
      orgRole === "admin" ? "Yes (manager, user, viewer)" :
      orgRole === "manager" ? "Yes (user, viewer only)" : "No"
    }\n`;
    prompt += `**Can manage members/roles:** ${
      orgRole === "owner" || orgRole === "admin" ? "Yes" : "No"
    }\n`;
    prompt += `**Can create workflows:** ${
      orgRole === "owner" || orgRole === "admin" || orgRole === "manager" ? "Yes" : "No"
    }\n`;
    prompt += `**Can create/edit data:** ${orgRole !== "viewer" ? "Yes" : "No (read-only)"}\n`;

    if (orgMemberCount > 0) {
      const roleSummary = Object.entries(orgMembersByRole)
        .map(([r, c]) => `${c} ${r}${(c as number) > 1 ? "s" : ""}`)
        .join(", ");
      prompt += `\n**Org members:** ${orgMemberCount} (${roleSummary})\n`;
    }
    if (orgDepartmentNames.length > 0) {
      prompt += `**Departments:** ${orgDepartmentNames.join(", ")}\n`;
    }
    if (pendingInviteCount > 0) {
      prompt += `**Pending invites:** ${pendingInviteCount}\n`;
    }
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
    if (crmSummary.reportCount > 0) prompt += `**Reports:** ${crmSummary.reportCount} saved report(s)\n`;
  }

  /* ── E-Commerce Summary ── */
  if (ecomSummary.shopifyConnected) {
    prompt += `\n## E-Commerce Data (Shopify)\n`;
    prompt += `**Status:** Connected${ecomSummary.lastSyncAt ? ` (last sync: ${new Date(ecomSummary.lastSyncAt).toLocaleDateString()})` : ""}\n`;
    if (ecomSummary.customerCount > 0) prompt += `**Customers:** ${ecomSummary.customerCount}\n`;
    if (ecomSummary.orderCount > 0) prompt += `**Orders:** ${ecomSummary.orderCount}\n`;
    if (ecomSummary.productCount > 0) prompt += `**Products:** ${ecomSummary.productCount}\n`;
    prompt += `Use query_ecommerce_analytics for deep analytics (revenue, AOV, LTV, repeat rate, top products, cohorts, RFM).\n`;
    prompt += `Use create_inline_chart and create_inline_table to present data visually in chat.\n`;
  }

  /* ── Customer Identity Resolution ── */
  if (identityStats && (identityStats.linked > 0 || identityStats.crm_only > 0 || identityStats.ecom_only > 0)) {
    const totalUnique = identityStats.crm_only + identityStats.linked + identityStats.ecom_only;
    prompt += `\n## Customer Identity Resolution\n`;
    prompt += `These are **exact counts** from the database — use them, do not estimate:\n`;
    prompt += `- **Linked** (in both CRM + Shopify): ${identityStats.linked}\n`;
    prompt += `- **CRM only** (not in Shopify): ${identityStats.crm_only}\n`;
    prompt += `- **Shopify only** (not in CRM): ${identityStats.ecom_only}\n`;
    prompt += `- **Total unique people** across all sources: ${totalUnique}\n`;
    prompt += `IMPORTANT: CRM Contacts (${identityStats.total_crm_contacts}) + Shopify Customers (${identityStats.total_ecom_customers}) ≠ total people because ${identityStats.linked} are the same person in both. Never simply add these numbers.\n`;
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
  }

  /* 2. Auth */
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { user, orgId } = orgCtx;
  const sessionId = crypto.randomUUID();

  /* 3. Parse request */
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { messages, currentPage, chatFileContents, activeReport } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response("Messages array is required", { status: 400 });
  }

  /* 4. RAG + Memory: Embed user's last message and retrieve relevant chunks + memories */
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let retrievedContext: SearchResult[] = [];
  let retrievedChunkIds: string[] = [];
  let memorySummary = "";
  let graphContextStr = "";

  // RAG + Memory + Graph retrieval (all non-fatal, independent try/catches)
  if (process.env.OPENAI_API_KEY && lastUserMessage.trim()) {
    // RAG search
    try {
      retrievedContext = await hybridSearch(supabase, user.id, lastUserMessage, { limit: 10 });
      retrievedChunkIds = retrievedContext.map((r) => r.id);
    } catch (err) {
      console.error("[RAG] Search failed:", err);
    }

    // Memory retrieval (separate try/catch so RAG failure doesn't block memory)
    try {
      const memories = await retrieveMemories(supabase, orgId, user.id, lastUserMessage, { limit: 10 });
      console.log(`[Memory] Retrieved ${memories.length} memories for: "${lastUserMessage.slice(0, 50)}"`);
      memorySummary = formatMemoriesForPrompt(memories);
      if (memorySummary) {
        console.log(`[Memory] Prompt section length: ${memorySummary.length} chars`);
      }
    } catch (err) {
      console.error("[Memory] Retrieval failed:", err);
    }
  }

  // Graph context retrieval (doesn't need OPENAI_API_KEY — uses label matching)
  if (lastUserMessage.trim()) {
    try {
      const graphResult = await getGraphContext(supabase, orgId, lastUserMessage);
      graphContextStr = graphResult.formatted;
      if (graphResult.resolvedEntities.length > 0) {
        console.log(`[Graph] Resolved ${graphResult.resolvedEntities.length} entities, ${graphResult.connectedNodes.length} connected nodes`);
      }
    } catch (err) {
      console.error("[Graph] Context retrieval failed:", err);
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
    { count: crmReportCount },
    // E-commerce lean queries
    { count: ecomCustomerCount },
    { count: ecomOrderCount },
    { count: ecomProductCount },
    { data: ecomConnector },
    // Org context
    { data: orgMembersData },
    { data: orgDeptsData },
    { count: orgPendingInviteCount },
  ] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("org_profiles").select("*").eq("org_id", orgId).single(),
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
    supabase.from("crm_reports").select("id", { count: "exact", head: true }),
    // E-commerce
    supabase.from("ecom_customers").select("id", { count: "exact", head: true }),
    supabase.from("ecom_orders").select("id", { count: "exact", head: true }),
    supabase.from("ecom_products").select("id", { count: "exact", head: true }),
    supabase.from("data_connectors").select("connector_type, status, last_sync_at").eq("connector_type", "shopify").limit(1),
    // Org context
    supabase.from("org_members").select("role").eq("org_id", orgId),
    supabase.from("org_departments").select("name").eq("org_id", orgId).order("name"),
    supabase.from("org_invites").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("accepted_at", null),
  ]);

  /* Fetch identity stats (non-blocking — null if no linked customers) */
  let identityStats: Awaited<ReturnType<typeof getIdentityStats>> | null = null;
  try {
    identityStats = await getIdentityStats(supabase, orgId);
  } catch {
    // Non-fatal — identity stats are informational
  }

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
    reportCount: crmReportCount ?? 0,
  };

  /* Org member/dept summary */
  const orgMembersByRole: Record<string, number> = {};
  for (const m of orgMembersData ?? []) {
    const r = m.role as string;
    orgMembersByRole[r] = (orgMembersByRole[r] ?? 0) + 1;
  }

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
    activeReport: activeReport ?? null,
    orgRole: orgCtx.role,
    orgMemberCount: orgMembersData?.length ?? 0,
    orgMembersByRole,
    orgDepartmentNames: (orgDeptsData ?? []).map((d) => d.name as string),
    pendingInviteCount: orgPendingInviteCount ?? 0,
    ecomSummary: {
      customerCount: ecomCustomerCount ?? 0,
      orderCount: ecomOrderCount ?? 0,
      productCount: ecomProductCount ?? 0,
      shopifyConnected: (ecomConnector ?? []).some((c: Record<string, unknown>) => c.status === "connected"),
      lastSyncAt: (ecomConnector ?? []).length > 0 ? ((ecomConnector as Record<string, unknown>[])[0].last_sync_at as string | null) : null,
    },
    identityStats,
    memorySummary,
    graphContext: graphContextStr,
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

    /* ── Timeout helper ── */
    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms / 1000}s`)), ms)
        ),
      ]);
    }

    const TOOL_TIMEOUT = 30_000;   // 30s per tool execution
    const STREAM_TIMEOUT = 90_000; // 90s per Anthropic API round

    const readable = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (!closed) controller.enqueue(chunk);
        };
        const safeClose = () => {
          if (!closed) { closed = true; controller.close(); }
        };

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
              safeEnqueue(encoder.encode(event.delta.text));
            }
          }

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

            /* Execute all tools via Action Framework (with per-tool timeout) */
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const toolBlock of toolUseBlocks) {
              let result: { success: boolean; message: string };
              try {
                result = await withTimeout(
                  executeAction(
                    toolBlock.name,
                    toolBlock.input as Record<string, unknown>,
                    supabase,
                    user.id,
                    orgId,
                    orgCtx.role,
                    sessionId
                  ),
                  TOOL_TIMEOUT,
                  `tool:${toolBlock.name}`
                );
              } catch (toolErr) {
                const errMsg = toolErr instanceof Error ? toolErr.message : "Tool execution failed";
                console.error(`[chat] Tool ${toolBlock.name} failed: ${errMsg}`);
                result = { success: false, message: errMsg };
              }
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
                safeEnqueue(encoder.encode(event.delta.text));
              }
            }

            currentMessage = await nextStream.finalMessage();

            // Accumulate token usage from this round
            totalInputTokens += currentMessage.usage?.input_tokens ?? 0;
            totalOutputTokens += currentMessage.usage?.output_tokens ?? 0;
            stopReason = currentMessage.stop_reason;
          }

          if (toolRounds >= MAX_TOOL_ROUNDS && currentMessage.stop_reason === "tool_use") {
            safeEnqueue(encoder.encode("\n\n*I reached the maximum number of tool rounds. Please try a simpler question or break it into parts.*"));
          }

          safeClose();
        } catch (err) {
          logError = err instanceof Error ? err.message : "Stream error";
          console.error("[chat] Stream error:", logError);
          safeEnqueue(encoder.encode(`\n\n*Error: ${logError}. Please try again.*`));
          safeClose();
        } finally {
          /* ── Log the LLM call (fire-and-forget) ── */
          const latencyMs = Date.now() - requestStart;
          const logEntry: LLMLogEntry = {
            userId: user.id,
            orgId,
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
            sessionId,
          };
          logInBackground(supabase, logEntry);

          /* ── Extract memories from conversation (fire-and-forget) ── */
          if (messages.length >= 1 && !logError) {
            extractAndStoreMemoriesInBackground(
              supabase,
              orgId,
              user.id,
              messages.map((m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant",
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              })),
              sessionId
            );
          }
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
