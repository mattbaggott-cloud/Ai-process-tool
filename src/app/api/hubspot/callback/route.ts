import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";
const HUBSPOT_REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("hubspot_oauth_state")?.value;

  const baseUrl = new URL(req.url).origin;

  // Validate state to prevent CSRF
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=no_code`);
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        redirect_uri: HUBSPOT_REDIRECT_URI,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("HubSpot token exchange failed:", err);
      return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=token_exchange`);
    }

    const tokens = await tokenRes.json();

    // Get HubSpot account info
    const infoRes = await fetch(
      "https://api.hubapi.com/oauth/v1/access-tokens/" + tokens.access_token
    );
    const info = infoRes.ok ? await infoRes.json() : {};

    // Authenticate user via Supabase SSR cookies
    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=not_authenticated`);
    }
    const { user, orgId } = orgCtx;

    const config = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      hub_id: String(info.hub_id || ""),
      scopes: tokens.scope?.split(" ") || [],
    };

    // Upsert connector row
    const { data: existing } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "hubspot")
      .maybeSingle();

    if (existing) {
      await supabase
        .from("data_connectors")
        .update({
          status: "connected",
          config,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("data_connectors").insert({
        user_id: user.id,
        org_id: orgId,
        connector_type: "hubspot",
        name: "HubSpot",
        description: `HubSpot account ${info.hub_domain || info.hub_id || ""}`,
        status: "connected",
        config,
      });
    }

    // Fetch connector ID for sync log
    const { data: connector } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "hubspot")
      .single();

    // Log the connection event
    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      connector_id: connector?.id || null,
      event_type: "success",
      message: `Connected to HubSpot account ${info.hub_domain || info.hub_id || ""}`,
      details: { hub_id: info.hub_id, hub_domain: info.hub_domain },
    });

    const response = NextResponse.redirect(`${baseUrl}/data?tab=connectors`);
    response.cookies.delete("hubspot_oauth_state");
    return response;
  } catch (error) {
    console.error("HubSpot OAuth callback error:", error);
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=callback_failed`);
  }
}
