import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { createHmac } from "crypto";

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const shop = searchParams.get("shop");
  const hmac = searchParams.get("hmac");
  const savedState = req.cookies.get("shopify_oauth_state")?.value;
  const savedShop = req.cookies.get("shopify_oauth_shop")?.value;

  const baseUrl = new URL(req.url).origin;

  // Validate state to prevent CSRF
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=invalid_state`);
  }

  // Validate shop matches what we originally requested
  if (!shop || (savedShop && shop !== savedShop)) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=invalid_shop`);
  }

  // Validate shop domain format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=invalid_shop`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=no_code`);
  }

  // Validate HMAC signature from Shopify
  if (hmac && SHOPIFY_CLIENT_SECRET) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("hmac");
    params.delete("signature");
    // Sort parameters alphabetically
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const computedHmac = createHmac("sha256", SHOPIFY_CLIENT_SECRET)
      .update(sortedParams)
      .digest("hex");

    if (computedHmac !== hmac) {
      console.error("Shopify HMAC validation failed");
      return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=invalid_hmac`);
    }
  }

  try {
    // Exchange authorization code for permanent access token
    const tokenRes = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: SHOPIFY_CLIENT_ID,
          client_secret: SHOPIFY_CLIENT_SECRET,
          code,
        }),
      }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Shopify token exchange failed:", err);
      return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=token_exchange`);
    }

    const tokens = await tokenRes.json();

    // Get shop info for description
    let shopInfo: Record<string, unknown> = {};
    try {
      const shopRes = await fetch(
        `https://${shop}/admin/api/2026-01/shop.json`,
        {
          headers: {
            "X-Shopify-Access-Token": tokens.access_token,
          },
        }
      );
      if (shopRes.ok) {
        const data = await shopRes.json();
        shopInfo = data.shop || {};
      }
    } catch {
      // Non-critical — continue without shop info
    }

    // Authenticate user via Supabase SSR cookies
    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=not_authenticated`);
    }
    const { user, orgId } = orgCtx;

    const config = {
      access_token: tokens.access_token,
      shop,
      scopes: (tokens.scope || "").split(",").filter(Boolean),
    };

    // Upsert connector row
    const { data: existing } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "shopify")
      .maybeSingle();

    const shopName =
      (shopInfo as Record<string, string>).name || shop.replace(".myshopify.com", "");

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
        connector_type: "shopify",
        name: "Shopify",
        description: `Shopify store: ${shopName}`,
        status: "connected",
        config,
      });
    }

    // Fetch connector ID for sync log
    const { data: connector } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "shopify")
      .single();

    // Log the connection event
    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      connector_id: connector?.id || null,
      event_type: "success",
      message: `Connected to Shopify store: ${shopName}`,
      details: { shop, shop_name: shopName },
    });

    const response = NextResponse.redirect(`${baseUrl}/data?tab=connectors`);
    response.cookies.delete("shopify_oauth_state");
    response.cookies.delete("shopify_oauth_shop");
    return response;
  } catch (error) {
    console.error("Shopify OAuth callback error:", error);
    return NextResponse.redirect(`${baseUrl}/data?tab=connectors&error=callback_failed`);
  }
}
