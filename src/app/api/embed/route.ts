import { createClient } from "@/lib/supabase/server";
import { embedDocument } from "@/lib/embeddings/index";

/**
 * POST /api/embed
 * Embeds a source record into document_chunks.
 * Called from client after file uploads or manual triggers.
 * Body: { sourceTable: string, sourceId: string }
 */
export async function POST(req: Request) {
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

  /* Parse body */
  let body: { sourceTable: string; sourceId: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceTable, sourceId } = body;
  if (!sourceTable || !sourceId) {
    return Response.json(
      { error: "sourceTable and sourceId are required" },
      { status: 400 }
    );
  }

  /* Allowed tables for embedding */
  const EMBEDDABLE_TABLES = [
    "goals", "sub_goals", "pain_points",
    "library_items", "library_files",
    "organization_files", "team_files",
  ];

  if (!EMBEDDABLE_TABLES.includes(sourceTable)) {
    return Response.json(
      { error: `Table "${sourceTable}" is not embeddable` },
      { status: 400 }
    );
  }

  /* Fetch the record server-side */
  const { data: record, error: fetchError } = await supabase
    .from(sourceTable)
    .select("*")
    .eq("id", sourceId)
    .single();

  if (fetchError || !record) {
    return Response.json(
      { error: `Record not found in ${sourceTable}` },
      { status: 404 }
    );
  }

  /* Embed it */
  try {
    const result = await embedDocument(
      supabase,
      user.id,
      sourceTable,
      sourceId,
      record
    );
    return Response.json({
      success: true,
      chunkCount: result.chunkCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding failed";
    console.error("Embed endpoint error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
