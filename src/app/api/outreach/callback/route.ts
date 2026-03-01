import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";

const OUTREACH_TOKEN_URL = "https://api.outreach.io/oauth/token";

function getOutreachClientId(): string {
  const id = process.env.OUTREACH_CLIENT_ID;
  if (!id) throw new Error("OUTREACH_CLIENT_ID is not set");
  return id;
}

function getOutreachClientSecret(): string {
  const secret = process.env.OUTREACH_CLIENT_SECRET;
  if (!secret) throw new Error("OUTREACH_CLIENT_SECRET is not set");
  return secret;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("outreach_oauth_state")?.value;
  const baseUrl = new URL(req.url).origin;

  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(
      `${baseUrl}/data?tab=connectors&error=invalid_state`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/data?tab=connectors&error=no_code`,
    );
  }

  try {
    const redirectUri = `${baseUrl}/api/outreach/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(OUTREACH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getOutreachClientId(),
        client_secret: getOutreachClientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const error = await tokenRes.text();
      throw new Error(`Outreach token exchange failed: ${tokenRes.status} — ${error}`);
    }

    const tokens = await tokenRes.json();

    const config = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || "",
      expires_at: Date.now() + (tokens.expires_in || 7200) * 1000,
      scopes: (tokens.scope || "").split(" "),
    };

    // Authenticate via Supabase
    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.redirect(
        `${baseUrl}/data?tab=connectors&error=not_authenticated`,
      );
    }
    const { user, orgId } = orgCtx;

    // Upsert connector row
    const { data: existing } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "outreach")
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
        connector_type: "outreach",
        name: "Outreach",
        description: "Outreach.io sales engagement platform",
        status: "connected",
        config,
      });
    }

    // Log connection
    const { data: connector } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "outreach")
      .single();

    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      connector_id: connector?.id || null,
      event_type: "success",
      message: "Connected to Outreach",
    });

    const response = NextResponse.redirect(`${baseUrl}/data?tab=connectors`);
    response.cookies.delete("outreach_oauth_state");
    return response;
  } catch (error) {
    console.error("Outreach OAuth callback error:", error);
    return NextResponse.redirect(
      `${baseUrl}/data?tab=connectors&error=callback_failed`,
    );
  }
}
