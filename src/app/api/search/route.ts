import { createClient } from "@/lib/supabase/server";
import { hybridSearch } from "@/lib/embeddings/search";

/**
 * GET /api/search?q=...&limit=20&source=goals,pain_points
 * Global hybrid search across all embedded content.
 */
export async function GET(req: Request) {
  /* Check for OpenAI API key */
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  /* Auth */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Parse query params */
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const limitStr = url.searchParams.get("limit");
  const sourceStr = url.searchParams.get("source");

  if (!query.trim()) {
    return Response.json({ results: [] });
  }

  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const sourceFilter = sourceStr
    ? sourceStr.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  /* Run hybrid search */
  try {
    const results = await hybridSearch(supabase, user.id, query, {
      limit: Math.min(limit, 50),
      sourceFilter,
    });

    /* Enrich results with titles from metadata */
    const enriched = results.map((r) => ({
      id: r.id,
      sourceTable: r.sourceTable,
      sourceId: r.sourceId,
      title: (r.metadata?.name ?? r.metadata?.title ?? r.sourceTable) as string,
      snippet: r.chunkText.slice(0, 200),
      score: Math.round(r.combinedScore * 1000) / 1000,
      metadata: r.metadata,
    }));

    return Response.json({ results: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    console.error("Search endpoint error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
