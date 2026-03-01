import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type GoogleConnectorConfig,
  ensureFreshGoogleToken,
} from "@/lib/google/oauth";
import { indexFiles, type IndexResult } from "@/lib/google-drive/sync-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/google-drive/index
 * Body: { fileIds: string[] }
 *
 * Indexes selected Drive files into the knowledge base.
 * Fetches content, creates library_items, and triggers embedding.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  let body: { fileIds?: string[]; forceReindex?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const fileIds = body.fileIds || [];
  const forceReindex = body.forceReindex === true;

  if (fileIds.length === 0) {
    return NextResponse.json(
      { error: "No file IDs provided" },
      { status: 400 },
    );
  }

  if (fileIds.length > 50) {
    return NextResponse.json(
      { error: "Maximum 50 files can be indexed at once" },
      { status: 400 },
    );
  }

  // Load the Drive connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "google_drive")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Google Drive is not connected" },
      { status: 400 },
    );
  }

  const config = connector.config as unknown as GoogleConnectorConfig;

  try {
    const freshConfig = await ensureFreshGoogleToken(
      config,
      supabase,
      connector.id,
    );

    const result = await indexFiles(
      freshConfig,
      supabase,
      user.id,
      orgId,
      fileIds,
      { forceReindex },
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Google Drive index error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Indexing failed" },
      { status: 500 },
    );
  }
}
