/**
 * SSE endpoint for campaign generation progress.
 * Streams real-time updates as each customer variant is generated.
 *
 * POST /api/campaigns/generate
 * Body: { campaignId: string }
 *
 * Events:
 *  - progress: { current, total }
 *  - variant_complete: { current, total, customerEmail }
 *  - done: { totalGenerated }
 *  - error: { error }
 */

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { generateCampaignVariants } from "@/lib/email/campaign-engine";

export async function POST(request: Request) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { orgId } = orgCtx;
  const body = await request.json() as { campaignId?: string };

  if (!body.campaignId) {
    return new Response(JSON.stringify({ error: "campaignId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await generateCampaignVariants(
          supabase,
          orgId,
          body.campaignId!,
          (event) => {
            send(event.type, {
              current: event.current,
              total: event.total,
              customerEmail: event.customerEmail,
              error: event.error,
            });
          }
        );

        if (result.status === "cancelled" || result.status === "paused") {
          send(result.status, {
            type: result.status,
            campaignId: body.campaignId,
            totalGenerated: result.totalGenerated,
          });
        } else {
          send("done", {
            type: "done",
            campaignId: body.campaignId,
            totalGenerated: result.totalGenerated,
            status: result.status,
          });
        }
      } catch (error) {
        console.error("Campaign generation stream error:", error);
        send("error", {
          type: "error",
          error: error instanceof Error ? error.message : "Generation failed",
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
