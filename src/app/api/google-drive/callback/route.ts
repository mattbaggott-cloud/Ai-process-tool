import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  exchangeGoogleCode,
  getGoogleUserInfo,
  buildGoogleConfig,
} from "@/lib/google/oauth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("gdrive_oauth_state")?.value;
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
    const redirectUri = `${baseUrl}/api/google-drive/callback`;
    const tokens = await exchangeGoogleCode({ code, redirectUri });
    const userInfo = await getGoogleUserInfo(tokens.access_token);
    const config = buildGoogleConfig(tokens, userInfo.email);

    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.redirect(
        `${baseUrl}/data?tab=connectors&error=not_authenticated`,
      );
    }
    const { user, orgId } = orgCtx;

    const { data: existing } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "google_drive")
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
        connector_type: "google_drive",
        name: "Google Drive",
        description: `Google Drive for ${userInfo.email || ""}`,
        status: "connected",
        config,
      });
    }

    const { data: connector } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "google_drive")
      .single();

    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      connector_id: connector?.id || null,
      event_type: "success",
      message: `Connected to Google Drive for ${userInfo.email || ""}`,
      details: { email: userInfo.email },
    });

    const response = NextResponse.redirect(`${baseUrl}/data?tab=connectors`);
    response.cookies.delete("gdrive_oauth_state");
    return response;
  } catch (error) {
    console.error("Google Drive OAuth callback error:", error);
    return NextResponse.redirect(
      `${baseUrl}/data?tab=connectors&error=callback_failed`,
    );
  }
}
