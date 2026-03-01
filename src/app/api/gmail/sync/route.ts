import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type GoogleConnectorConfig,
  ensureFreshGoogleToken,
} from "@/lib/google/oauth";
import { syncMessages, extractContacts, logSync } from "@/lib/gmail/sync-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  // Load the Gmail connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "gmail")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Gmail is not connected" },
      { status: 400 },
    );
  }

  const config = connector.config as unknown as GoogleConnectorConfig;

  // Define sync steps
  type SyncStep = {
    key: string;
    label: string;
    fn: (cfg: GoogleConnectorConfig) => Promise<{
      created: number;
      updated: number;
      skipped: number;
      errors: number;
    }>;
  };

  const steps: SyncStep[] = [
    {
      key: "messages",
      label: "Syncing messages",
      fn: (cfg) => syncMessages(cfg, supabase, user.id, orgId, connector.id),
    },
    {
      key: "contacts",
      label: "Extracting contacts",
      fn: () => extractContacts(supabase, user.id, orgId),
    },
  ];

  const totalSteps = steps.length;

  // Create SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Refresh token if expired
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
          "Starting Gmail sync",
        );

        const results: Record<
          string,
          { created: number; updated: number; skipped: number; errors: number }
        > = {};

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          // Emit started event
          send("progress", {
            type: "progress",
            step: step.key,
            label: step.label,
            status: "started",
            stepIndex: i,
            totalSteps,
          });

          try {
            const result = await step.fn(freshConfig);
            results[step.key] = result;

            // Emit completed event
            send("progress", {
              type: "progress",
              step: step.key,
              label: step.label,
              status: "completed",
              stepIndex: i,
              totalSteps,
              result,
            });
          } catch (stepError) {
            console.error(`Gmail sync step ${step.key} error:`, stepError);
            results[step.key] = { created: 0, updated: 0, skipped: 0, errors: -1 };

            send("progress", {
              type: "progress",
              step: step.key,
              label: step.label,
              status: "error",
              stepIndex: i,
              totalSteps,
              error:
                stepError instanceof Error ? stepError.message : "Step failed",
            });
          }
        }

        // Update last_sync_at
        await supabase
          .from("data_connectors")
          .update({
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", connector.id);

        const totalErrors = Object.values(results).reduce(
          (sum, r) => sum + Math.max(0, r.errors),
          0,
        );

        await logSync(
          supabase,
          user.id,
          orgId,
          connector.id,
          totalErrors > 0 ? "warning" : "success",
          `Gmail sync completed: ${JSON.stringify(results)}`,
          results,
        );

        // Emit done event
        send("done", {
          type: "done",
          results,
          totalErrors,
        });
      } catch (error) {
        console.error("Gmail sync stream error:", error);
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
