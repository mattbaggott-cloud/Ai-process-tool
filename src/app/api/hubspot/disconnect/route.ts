import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { user, orgId } = orgCtx;

    const body = await req.json().catch(() => ({}));
    const connectorId = body.connector_id as string | undefined;

    // Find the HubSpot connector
    let query = supabase
      .from("data_connectors")
      .select("id, config")
      .eq("user_id", user.id)
      .eq("connector_type", "hubspot");

    if (connectorId) {
      query = query.eq("id", connectorId);
    }

    const { data: connector } = await query.maybeSingle();

    if (!connector) {
      return NextResponse.json({ error: "HubSpot connector not found" }, { status: 404 });
    }

    // Best-effort: revoke the token at HubSpot
    const config = connector.config as Record<string, unknown>;
    if (config?.refresh_token) {
      await fetch("https://api.hubapi.com/oauth/v1/refresh-tokens/" + config.refresh_token, {
        method: "DELETE",
      }).catch(() => {});
    }

    // Clear config and reset status
    await supabase
      .from("data_connectors")
      .update({
        status: "available",
        config: {},
        last_sync_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connector.id);

    // Log the disconnection
    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      connector_id: connector.id,
      event_type: "info",
      message: "Disconnected from HubSpot",
      details: {},
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("HubSpot disconnect error:", error);
    return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
  }
}
