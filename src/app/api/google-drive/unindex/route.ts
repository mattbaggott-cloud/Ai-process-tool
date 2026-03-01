import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { unindexFiles } from "@/lib/google-drive/sync-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/google-drive/unindex
 * Body: { fileIds: string[] }
 *
 * Removes selected Drive files from the knowledge base.
 * Deletes library_items, embeddings, deactivates graph nodes,
 * and resets drive_files indexed flags.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { orgId } = orgCtx;

  let body: { fileIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const fileIds = body.fileIds || [];
  if (fileIds.length === 0) {
    return NextResponse.json(
      { error: "No file IDs provided" },
      { status: 400 },
    );
  }

  if (fileIds.length > 50) {
    return NextResponse.json(
      { error: "Maximum 50 files can be un-indexed at once" },
      { status: 400 },
    );
  }

  try {
    const result = await unindexFiles(supabase, orgId, fileIds);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Google Drive unindex error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Un-indexing failed" },
      { status: 500 },
    );
  }
}
