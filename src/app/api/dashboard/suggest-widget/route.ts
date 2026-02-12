import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { DATA_SOURCES } from "@/lib/dashboard/data-sources";

/* ── Build a reference of available sources for Claude ── */

function buildSourcesReference(): string {
  const lines: string[] = [];
  for (const [key, src] of Object.entries(DATA_SOURCES)) {
    const metrics = src.metrics.map((m) => m.key).join(", ");
    const dims = src.dimensions.map((d) => `${d.key} (${d.label})`).join(", ");
    lines.push(`- **${key}** ("${src.label}"): metrics=[${metrics}], dimensions=[${dims}]`);
  }
  return lines.join("\n");
}

/* ── POST handler ── */

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  /* Auth */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Parse body */
  let description: string;
  try {
    const body = await req.json();
    description = body.description;
    if (!description || typeof description !== "string") {
      return Response.json({ error: "description is required" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  /* Build prompt */
  const systemPrompt = `You are a dashboard widget configuration AI. Given a user's description, return a JSON object that configures a dashboard widget.

Available data sources:
${buildSourcesReference()}

Available widget types: metric, bar, pie, line, table, progress

Rules:
- "metric" type: shows a single number (no group_by needed)
- "bar", "pie", "line" types: group data by a dimension (group_by required)
- "table" type: shows raw rows (no group_by)
- "progress" type: shows KPI current vs target bars (only works with team_kpis source, metric should be "sum:current_value")
- Pick the widget type that best matches what the user is asking for
- Pick a clear, concise title
- For size: use cols=1 for simple widgets, cols=2 for detailed ones; height "sm" for metrics, "md" for charts, "lg" for large tables/charts

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "type": "metric|bar|pie|line|table|progress",
  "title": "Human readable title",
  "data_source": "key from the sources above",
  "metric": "valid metric key for that source",
  "group_by": "valid dimension key or null",
  "size": { "cols": 1, "height": "md" }
}`;

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: description }],
    });

    /* Extract text from response */
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return Response.json({ error: "No response from AI" }, { status: 502 });
    }

    /* Parse JSON */
    let config;
    try {
      config = JSON.parse(textBlock.text.trim());
    } catch {
      return Response.json({ error: "AI returned invalid JSON", raw: textBlock.text }, { status: 502 });
    }

    /* Validate against registry */
    const source = DATA_SOURCES[config.data_source];
    if (!source) {
      return Response.json({ error: `Unknown data source: ${config.data_source}` }, { status: 422 });
    }

    const validTypes = ["metric", "bar", "pie", "line", "table", "progress"];
    if (!validTypes.includes(config.type)) {
      config.type = "bar";
    }

    /* Validate metric exists */
    if (!source.metrics.some((m) => m.key === config.metric)) {
      config.metric = source.metrics[0]?.key ?? "count";
    }

    /* Validate dimension exists */
    if (config.group_by && !source.dimensions.some((d) => d.key === config.group_by)) {
      config.group_by = source.dimensions[0]?.key ?? null;
    }

    /* Ensure size */
    if (!config.size || typeof config.size !== "object") {
      config.size = { cols: 1, height: "md" };
    }
    if (![1, 2].includes(config.size.cols)) config.size.cols = 1;
    if (!["sm", "md", "lg"].includes(config.size.height)) config.size.height = "md";

    return Response.json({ widget: config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
