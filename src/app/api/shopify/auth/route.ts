import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";

// Scopes — match what's configured in the Shopify Partner app
const SCOPES = [
  "read_analytics",
  "read_customer_events",
  "read_all_cart_transforms",
  "read_cash_tracking",
  "read_channels",
  "read_companies",
  "read_customers",
  "read_price_rules",
  "read_discounts",
  "read_files",
  "read_fulfillments",
  "read_gift_card_transactions",
  "read_gift_cards",
  "write_inventory",
  "read_locations",
  "read_marketing_integrated_campaigns",
  "write_marketing_events",
  "read_markets",
  "read_orders",
  "read_product_listings",
  "read_products",
  "read_purchase_options",
  "write_reports",
  "read_returns",
  "read_content",
  "customer_read_orders",
].join(",");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");

  if (!shop) {
    return NextResponse.json(
      { error: "Missing required 'shop' query parameter (e.g. my-store.myshopify.com)" },
      { status: 400 }
    );
  }

  // Validate shop domain format to prevent open redirect
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.json(
      { error: "Invalid shop domain. Must be a valid *.myshopify.com domain." },
      { status: 400 }
    );
  }

  const baseUrl = new URL(req.url).origin;
  const redirectUri =
    process.env.SHOPIFY_REDIRECT_URI || `${baseUrl}/api/shopify/callback`;

  if (!SHOPIFY_CLIENT_ID) {
    return NextResponse.json(
      { error: "Shopify OAuth is not configured" },
      { status: 500 }
    );
  }

  const state = randomUUID();

  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(authorizeUrl);

  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  // Persist shop domain so we can use it in the callback
  response.cookies.set("shopify_oauth_shop", shop, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
