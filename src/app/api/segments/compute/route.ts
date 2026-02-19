import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { computeBehavioralProfiles } from "@/lib/segmentation/behavioral-engine";

export async function POST() {
  /* Auth */
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);
  if (!orgCtx) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { orgId } = orgCtx;
  const encoder = new TextEncoder();

  /* SSE stream — same pattern as /api/shopify/sync */
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send("progress", { step: "computing", message: "Computing behavioral profiles..." });

        const result = await computeBehavioralProfiles(supabase, orgId);

        send("done", {
          profiles_updated: result.profiles_updated,
          computed_at: result.computed_at,
          message: `Successfully computed ${result.profiles_updated} behavioral profiles.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        send("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
