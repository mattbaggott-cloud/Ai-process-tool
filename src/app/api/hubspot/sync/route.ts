import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type HubSpotConfig, type HubSpotSyncDirection } from "@/lib/types/database";
import { getOrgContext } from "@/lib/org";
import {
  refreshTokenIfNeeded,
  importContacts,
  importCompanies,
  importDeals,
  exportContacts,
  exportCompanies,
  exportDeals,
  logSync,
} from "@/lib/hubspot/sync-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth and connector loading happen before the stream
  // so we can return proper error responses
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  let body: { direction?: string; objects?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const direction: HubSpotSyncDirection = (body.direction as HubSpotSyncDirection) || "import";
  const objects: string[] = body.objects || ["contacts", "companies", "deals"];

  // Load the HubSpot connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "hubspot")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "HubSpot is not connected" },
      { status: 400 }
    );
  }

  const config = connector.config as unknown as HubSpotConfig;

  // Build the list of steps
  type SyncStep = {
    key: string;
    label: string;
    fn: (cfg: HubSpotConfig) => Promise<{ created: number; updated: number; skipped: number; errors: number }>;
  };

  const steps: SyncStep[] = [];

  if (direction === "import" || direction === "both") {
    if (objects.includes("contacts")) {
      steps.push({
        key: "contacts_import",
        label: "Importing contacts",
        fn: (cfg) => importContacts(cfg, supabase, user.id, orgId, connector.id),
      });
    }
    if (objects.includes("companies")) {
      steps.push({
        key: "companies_import",
        label: "Importing companies",
        fn: (cfg) => importCompanies(cfg, supabase, user.id, orgId, connector.id),
      });
    }
    if (objects.includes("deals")) {
      steps.push({
        key: "deals_import",
        label: "Importing deals",
        fn: (cfg) => importDeals(cfg, supabase, user.id, orgId, connector.id),
      });
    }
  }

  if (direction === "export" || direction === "both") {
    if (objects.includes("contacts")) {
      steps.push({
        key: "contacts_export",
        label: "Exporting contacts",
        fn: (cfg) => exportContacts(cfg, supabase, user.id, orgId, connector.id, connector.last_sync_at),
      });
    }
    if (objects.includes("companies")) {
      steps.push({
        key: "companies_export",
        label: "Exporting companies",
        fn: (cfg) => exportCompanies(cfg, supabase, user.id, orgId, connector.id, connector.last_sync_at),
      });
    }
    if (objects.includes("deals")) {
      steps.push({
        key: "deals_export",
        label: "Exporting deals",
        fn: (cfg) => exportDeals(cfg, supabase, user.id, orgId, connector.id, connector.last_sync_at),
      });
    }
  }

  const totalSteps = steps.length;

  // Create SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Refresh token if expired
        const freshConfig = await refreshTokenIfNeeded(config, supabase, connector.id);

        await logSync(supabase, user.id, orgId, connector.id, "info",
          `Starting ${direction} sync for: ${objects.join(", ")}`);

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
            console.error(`Sync step ${step.key} error:`, stepError);
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

        await logSync(supabase, user.id, orgId, connector.id,
          totalErrors > 0 ? "warning" : "success",
          `Sync completed: ${JSON.stringify(results)}`,
          results
        );

        // Emit done event
        send("done", {
          type: "done",
          results,
          totalErrors,
        });
      } catch (error) {
        console.error("HubSpot sync stream error:", error);
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
