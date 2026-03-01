import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type GoogleConnectorConfig,
  ensureFreshGoogleToken,
} from "@/lib/google/oauth";
import { syncFileMetadata, logSync } from "@/lib/google-drive/sync-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

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

  // Single step: metadata sync
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const freshConfig = await ensureFreshGoogleToken(
          config,
          supabase,
          connector.id,
        );

        await logSync(
          supabase,
          user.id,
          orgId,
          connector.id,
          "info",
          "Starting Google Drive metadata sync",
        );

        send("progress", {
          type: "progress",
          step: "metadata",
          label: "Syncing file metadata",
          status: "started",
          stepIndex: 0,
          totalSteps: 1,
        });

        const result = await syncFileMetadata(
          freshConfig,
          supabase,
          user.id,
          orgId,
          connector.id,
        );

        send("progress", {
          type: "progress",
          step: "metadata",
          label: "Syncing file metadata",
          status: "completed",
          stepIndex: 0,
          totalSteps: 1,
          result,
        });

        // Update last_sync_at
        await supabase
          .from("data_connectors")
          .update({
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", connector.id);

        await logSync(
          supabase,
          user.id,
          orgId,
          connector.id,
          result.errors > 0 ? "warning" : "success",
          `Drive metadata sync completed: ${result.created} files synced, ${result.errors} errors`,
          { result },
        );

        send("done", {
          type: "done",
          results: { metadata: result },
          totalErrors: result.errors,
        });
      } catch (error) {
        console.error("Google Drive sync stream error:", error);
        send("error", {
          type: "error",
          error: error instanceof Error ? error.message : "Sync failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
