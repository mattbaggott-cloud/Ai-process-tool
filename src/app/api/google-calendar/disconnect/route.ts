import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type GoogleConnectorConfig,
  revokeGoogleToken,
} from "@/lib/google/oauth";

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
    .eq("connector_type", "google_calendar")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Google Calendar connector not found" },
      { status: 404 },
    );
  }

  // Best-effort revoke token
  const config = connector.config as unknown as GoogleConnectorConfig;
  if (config?.access_token) {
    await revokeGoogleToken(config.access_token);
  }

  // Reset connector
  await supabase
    .from("data_connectors")
    .update({
      status: "available",
      config: {},
      last_sync_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connector.id);

  // Log disconnection
  await supabase.from("data_sync_log").insert({
    user_id: user.id,
    org_id: orgId,
    connector_id: connector.id,
    event_type: "info",
    message: "Disconnected Google Calendar",
  });

  return NextResponse.json({ success: true });
}
