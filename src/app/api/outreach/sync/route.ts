import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type OutreachConfig,
  refreshOutreachToken,
  syncProspects,
  syncSequences,
  syncTasks,
  logSync,
} from "@/lib/outreach/sync-service";

export const dynamic = "force-dynamic";

export async function POST() {
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
    .eq("connector_type", "outreach")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Outreach is not connected" },
      { status: 400 },
    );
  }

  const config = connector.config as unknown as OutreachConfig;

  type SyncStep = {
    key: string;
    label: string;
    fn: (cfg: OutreachConfig) => Promise<{
      created: number;
      updated: number;
      skipped: number;
      errors: number;
    }>;
  };

  const steps: SyncStep[] = [
    {
      key: "prospects",
      label: "Syncing prospects",
      fn: (cfg) => syncProspects(cfg, supabase, user.id, orgId, connector.id),
    },
    {
      key: "sequences",
      label: "Syncing sequences",
      fn: (cfg) => syncSequences(cfg, supabase, user.id, orgId, connector.id),
    },
    {
      key: "tasks",
      label: "Syncing tasks",
      fn: (cfg) => syncTasks(cfg, supabase, user.id, orgId, connector.id),
    },
  ];

  const totalSteps = steps.length;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const freshConfig = await refreshOutreachToken(
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
          "Starting Outreach sync",
        );

        const results: Record<
          string,
          { created: number; updated: number; skipped: number; errors: number }
        > = {};

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

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
            console.error(`Outreach sync step ${step.key} error:`, stepError);
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
          `Outreach sync completed: ${JSON.stringify(results)}`,
          results,
        );

        send("done", {
          type: "done",
          results,
          totalErrors,
        });
      } catch (error) {
        console.error("Outreach sync stream error:", error);
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
