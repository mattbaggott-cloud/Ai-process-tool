import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type ShopifyConfig } from "@/lib/types/database";
import { getOrgContext } from "@/lib/org";
import {
  importCustomers,
  importOrders,
  importProducts,
  syncGraphNodes,
  logSync,
} from "@/lib/shopify/sync-service";
import { triggerPostSyncResolution } from "@/lib/identity/post-sync-resolution";

export const dynamic = "force-dynamic";

export async function POST() {
  // Auth and connector loading happen before the stream
  // so we can return proper error responses
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, orgId } = orgCtx;

  // Load the Shopify connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "shopify")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Shopify is not connected" },
      { status: 400 }
    );
  }

  const config = connector.config as unknown as ShopifyConfig;

  // Build the list of sync steps
  type SyncStep = {
    key: string;
    label: string;
    fn: (cfg: ShopifyConfig) => Promise<{ created: number; updated: number; skipped: number; errors: number }>;
  };

  const steps: SyncStep[] = [
    {
      key: "customers_import",
      label: "Importing customers",
      fn: (cfg) => importCustomers(cfg, supabase, user.id, orgId, connector.id),
    },
    {
      key: "orders_import",
      label: "Importing orders",
      fn: (cfg) => importOrders(cfg, supabase, user.id, orgId, connector.id),
    },
    {
      key: "products_import",
      label: "Importing products",
      fn: (cfg) => importProducts(cfg, supabase, user.id, orgId, connector.id),
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
        await logSync(supabase, user.id, orgId, connector.id, "info",
          "Starting Shopify sync: customers, orders, products");

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
            console.error(`Shopify sync step ${step.key} error:`, stepError);
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

        // ── Post-sync: Graph nodes + Identity resolution ──
        // These run silently (no SSE step) as fast finalization

        try {
          const graphCounts = await syncGraphNodes(supabase, orgId);
          await logSync(supabase, user.id, orgId, connector.id, "info",
            `Graph nodes synced: ${graphCounts.customers} customers, ${graphCounts.orders} orders, ${graphCounts.products} products`);
        } catch (postSyncError) {
          console.error("Post-sync graph error (non-fatal):", postSyncError);
        }

        try {
          const idResult = await triggerPostSyncResolution(supabase, orgId, user.id);
          if (idResult.totalCandidates > 0) {
            await logSync(supabase, user.id, orgId, connector.id, "info",
              `Identity resolution: ${idResult.autoApplied} auto-applied, ${idResult.pendingReview} pending review`);
          }
        } catch (resError) {
          console.error("Post-sync identity resolution error (non-fatal):", resError);
        }

        // Update last_sync_at
        await supabase
          .from("data_connectors")
          .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", connector.id);

        const totalErrors = Object.values(results).reduce((sum, r) => sum + Math.max(0, r.errors), 0);

        await logSync(supabase, user.id, orgId, connector.id,
          totalErrors > 0 ? "warning" : "success",
          `Shopify sync completed: ${JSON.stringify(results)}`,
          results
        );

        // Emit done event
        send("done", {
          type: "done",
          results,
          totalErrors,
        });
      } catch (error) {
        console.error("Shopify sync stream error:", error);
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
