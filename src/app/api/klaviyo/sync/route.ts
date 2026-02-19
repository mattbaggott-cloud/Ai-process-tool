import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type KlaviyoConfig } from "@/lib/types/database";
import { getOrgContext } from "@/lib/org";
import {
  importLists,
  importProfiles,
  importCampaigns,
  importCampaignMetrics,
  importCampaignTemplates,
  logSync,
} from "@/lib/klaviyo/sync-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/klaviyo/sync
 * SSE streaming sync of Klaviyo data: lists, profiles, campaigns, metrics, templates.
 */
export async function POST() {
  // Auth and connector loading before the stream
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  // Load the Klaviyo connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "klaviyo")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Klaviyo is not connected" },
      { status: 400 }
    );
  }

  const config = connector.config as unknown as KlaviyoConfig;

  // Build the list of sync steps
  type SyncStep = {
    key: string;
    label: string;
    fn: (cfg: KlaviyoConfig) => Promise<{ created: number; updated: number; skipped: number; errors: number }>;
  };

  const steps: SyncStep[] = [
    {
      key: "lists_import",
      label: "Importing lists",
      fn: (cfg) => importLists(cfg, supabase, user.id, orgId, connector.id as string),
    },
    {
      key: "profiles_import",
      label: "Importing subscriber profiles",
      fn: (cfg) => importProfiles(cfg, supabase, user.id, orgId, connector.id as string),
    },
    {
      key: "campaigns_import",
      label: "Importing campaigns",
      fn: (cfg) => importCampaigns(cfg, supabase, user.id, orgId, connector.id as string),
    },
    {
      key: "metrics_import",
      label: "Importing campaign performance",
      fn: (cfg) => importCampaignMetrics(cfg, supabase, user.id, orgId, connector.id as string),
    },
    {
      key: "templates_import",
      label: "Importing email templates as brand assets",
      fn: (cfg) => importCampaignTemplates(cfg, supabase, user.id, orgId, connector.id as string),
    },
  ];

  const totalSteps = steps.length;

  // Create SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await logSync(supabase, user.id, orgId, connector.id as string, "info",
          "Starting Klaviyo sync: lists, profiles, campaigns, metrics, templates");

        const results: Record<string, { created: number; updated: number; skipped: number; errors: number }> = {};

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
            const result = await step.fn(config);
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
            console.error(`Klaviyo sync step ${step.key} error:`, stepError);
            results[step.key] = { created: 0, updated: 0, skipped: 0, errors: -1 };

            send("progress", {
              type: "progress",
              step: step.key,
              label: step.label,
              status: "error",
              stepIndex: i,
              totalSteps,
              error: stepError instanceof Error ? stepError.message : "Step failed",
            });
          }
        }

        // Update last_sync_at
        await supabase
          .from("data_connectors")
          .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", connector.id);

        const totalErrors = Object.values(results).reduce((sum, r) => sum + Math.max(0, r.errors), 0);

        await logSync(supabase, user.id, orgId, connector.id as string,
          totalErrors > 0 ? "warning" : "success",
          `Klaviyo sync completed: ${JSON.stringify(results)}`,
          results
        );

        // Emit done event
        send("done", {
          type: "done",
          results,
          totalErrors,
        });
      } catch (error) {
        console.error("Klaviyo sync stream error:", error);
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
      "Connection": "keep-alive",
    },
  });
}
