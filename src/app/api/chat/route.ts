import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { getToolDefinitions } from "./tools";
import { executeTool } from "./tool-executor";

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
  teams: Record<string, unknown>[];
  teamRoles: Record<string, unknown>[];
  teamKpis: Record<string, unknown>[];
  teamTools: Record<string, unknown>[];
  teamFiles: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  subGoals: Record<string, unknown>[];
  libraryItems: Record<string, unknown>[];
  libraryFiles: Record<string, unknown>[];
  stackTools: Record<string, unknown>[];
  catalogSummary: { category: string; count: number }[];
  catalogSubcategories: { category: string; subcategory: string; count: number }[];
  chatFileContents: { name: string; content: string }[];
  currentPage: string;
}): string {
  const {
    email, teams, teamRoles, teamKpis, teamTools, teamFiles,
    goals, subGoals, libraryItems, libraryFiles,
    stackTools, catalogSummary, catalogSubcategories,
    chatFileContents, currentPage,
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

  const filesByTeam: Record<string, typeof teamFiles> = {};
  for (const f of teamFiles) {
    const tid = f.team_id as string;
    if (!filesByTeam[tid]) filesByTeam[tid] = [];
    filesByTeam[tid].push(f);
  }

  /* Group sub-goals by goal_id */
  const subsByGoal: Record<string, typeof subGoals> = {};
  for (const s of subGoals) {
    const gid = s.goal_id as string;
    if (!subsByGoal[gid]) subsByGoal[gid] = [];
    subsByGoal[gid].push(s);
  }

  /* ── Build sections ── */

  let prompt = `You are an AI business operations copilot for ${email}'s workspace.

## Your Role
- Help model business processes, team structures, and workflows
- Suggest optimizations based on the user's actual data below
- Help with KPI tracking, goal setting, and tool evaluation
- Be concise and actionable — reference the user's real data when relevant
- When the user is on a specific page, prioritize context about that area
- Format responses with clear structure (use bullet points, headers, etc.)

## Your Capabilities
You can take actions in the user's workspace using tools:
- Create teams and add roles, KPIs, and tools to them
- Delete roles, KPIs, and tools from teams
- Create goals and sub-goals, update their status
- Delete goals (and all their sub-goals)
- Create library items (notes, documents, templates)
- Search the tool catalog for tool details, features, pricing, and comparisons
- Add or remove tools from the user's tech stack
- Compare 2-3 tools side by side from the catalog

When the user asks you to set something up, create something, delete something, or make changes, use the appropriate tool rather than just describing what they should do manually.
If a role, KPI, or tool with the same name already exists on a team, the system will update it instead of creating a duplicate.
The UI updates automatically after changes — no need to tell the user to refresh.
When the user asks about tools, use search_tool_catalog to look up details. When comparing tools, use compare_tools to get full data.

## User's Current Page
${currentPage}
`;

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

      const files = filesByTeam[tid] ?? [];
      if (files.length > 0) {
        prompt += `\nTeam Documents:\n`;
        for (const f of files) {
          const content = truncate(f.text_content as string | null, 2000);
          if (content) {
            prompt += `- ${f.name}:\n${content}\n`;
          } else {
            prompt += `- ${f.name} (no text extracted)\n`;
          }
        }
      }
    }
  }

  /* ── Goals ── */
  if (goals.length > 0) {
    prompt += `\n## Goals\n`;
    for (const g of goals) {
      const gid = g.id as string;
      prompt += `\n### ${g.name} [${g.status}]\n`;
      if (g.description) prompt += `Description: ${g.description}\n`;
      if (g.owner) prompt += `Owner: ${g.owner}\n`;
      if (g.start_date || g.end_date) prompt += `Timeline: ${g.start_date ?? "?"} - ${g.end_date ?? "?"}\n`;
      if (g.metric) prompt += `Metric: ${g.metric} / Target: ${g.metric_target}\n`;
      if (g.teams && (g.teams as string[]).length > 0) prompt += `Teams: ${(g.teams as string[]).join(", ")}\n`;

      const subs = subsByGoal[gid] ?? [];
      if (subs.length > 0) {
        prompt += `Sub-goals:\n`;
        for (const s of subs) {
          prompt += `- ${s.name} [${s.status}]`;
          if (s.owner) prompt += ` - ${s.owner}`;
          if (s.end_date) prompt += ` - Due: ${s.end_date}`;
          prompt += `\n`;
        }
      }
    }
  }

  /* ── Library ── */
  if (libraryItems.length > 0 || libraryFiles.length > 0) {
    prompt += `\n## Library\n`;

    if (libraryItems.length > 0) {
      prompt += `\n### Notes & Documents\n`;
      for (const item of libraryItems) {
        prompt += `- ${item.title} (${item.category})`;
        const content = truncate(item.content as string | null, 500);
        if (content) prompt += `: ${content}`;
        const tags = item.tags as string[] | null;
        if (tags && tags.length > 0) prompt += `\n  Tags: ${tags.join(", ")}`;
        prompt += `\n`;
      }
    }

    if (libraryFiles.length > 0) {
      prompt += `\n### Library Files\n`;
      for (const f of libraryFiles) {
        const content = truncate(f.text_content as string | null, 2000);
        if (content) {
          prompt += `- ${f.name}:\n${content}\n`;
        } else {
          prompt += `- ${f.name} (no text extracted)\n`;
        }
      }
    }
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

  /* ── Session files ── */
  if (chatFileContents.length > 0) {
    prompt += `\n## Session Files (uploaded for this conversation)\n`;
    for (const f of chatFileContents) {
      prompt += `\n### ${f.name}\n${truncate(f.content, 3000)}\n`;
    }
  }

  return prompt;
}

/* ── POST handler ──────────────────────────────────────── */

export async function POST(req: Request) {
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

  /* 4. Load ALL user data in parallel */
  const [
    { data: teams },
    { data: teamRoles },
    { data: teamKpis },
    { data: teamTools },
    { data: teamFiles },
    { data: goals },
    { data: subGoals },
    { data: libraryItems },
    { data: libraryFiles },
    { data: stackTools },
    { data: catalogCategories },
  ] = await Promise.all([
    supabase.from("teams").select("*").order("created_at"),
    supabase.from("team_roles").select("*").order("created_at"),
    supabase.from("team_kpis").select("*").order("created_at"),
    supabase.from("team_tools").select("*").order("created_at"),
    supabase.from("team_files").select("id, team_id, name, text_content").order("added_at"),
    supabase.from("goals").select("*").order("created_at", { ascending: false }),
    supabase.from("sub_goals").select("*").order("created_at"),
    supabase.from("library_items").select("*").order("updated_at", { ascending: false }),
    supabase.from("library_files").select("id, name, text_content").order("added_at", { ascending: false }),
    supabase.from("user_stack_tools").select("*").order("created_at", { ascending: false }),
    supabase.from("tool_catalog").select("category, subcategory"),
  ]);

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

  /* 5. Build system prompt */
  const systemPrompt = buildSystemPrompt({
    email: user.email ?? "User",
    teams: teams ?? [],
    teamRoles: teamRoles ?? [],
    teamKpis: teamKpis ?? [],
    teamTools: teamTools ?? [],
    teamFiles: teamFiles ?? [],
    goals: goals ?? [],
    subGoals: subGoals ?? [],
    libraryItems: libraryItems ?? [],
    libraryFiles: libraryFiles ?? [],
    stackTools: stackTools ?? [],
    catalogSummary,
    catalogSubcategories,
    chatFileContents: chatFileContents ?? [],
    currentPage: currentPage ?? "/",
  });

  /* 6. Call Claude with streaming + tool use */
  const anthropic = new Anthropic();
  const tools = getToolDefinitions();
  const encoder = new TextEncoder();

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
          let rounds = 0;
          const MAX_TOOL_ROUNDS = 5;

          while (currentMessage.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
            rounds++;

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
          }

          controller.close();
        } catch (err) {
          controller.error(err);
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
