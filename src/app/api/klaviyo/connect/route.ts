import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import { validateApiKey, logSync } from "@/lib/klaviyo/sync-service";

/**
 * POST /api/klaviyo/connect
 * Validates a Klaviyo private API key and stores the connector.
 * Klaviyo uses private API keys (not OAuth) — user pastes key, we validate via GET /accounts/.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const orgCtx = await getOrgContext(supabase);

    if (!orgCtx) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { user, orgId } = orgCtx;

    const body = await req.json().catch(() => ({}));
    const apiKey = (body.api_key as string || "").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }

    // Validate the key against Klaviyo's API
    const validation = await validateApiKey(apiKey);

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid API key" },
        { status: 400 }
      );
    }

    // Store/update the connector
    const config = {
      api_key: apiKey,
      api_revision: "2025-01-15",
      account_name: validation.accountName,
    };

    const { data: existing } = await supabase
      .from("data_connectors")
      .select("id")
      .eq("user_id", user.id)
      .eq("connector_type", "klaviyo")
      .maybeSingle();

    let connectorId: string;

    if (existing) {
      await supabase
        .from("data_connectors")
        .update({
          status: "connected",
          config,
          name: "Klaviyo",
          description: `Klaviyo account: ${validation.accountName}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      connectorId = existing.id as string;
    } else {
      const { data: inserted } = await supabase
        .from("data_connectors")
        .insert({
          user_id: user.id,
          org_id: orgId,
          connector_type: "klaviyo",
          name: "Klaviyo",
          description: `Klaviyo account: ${validation.accountName}`,
          status: "connected",
          config,
        })
        .select("id")
        .single();
      connectorId = (inserted?.id as string) || "";
    }

    // Log the connection
    if (connectorId) {
      await logSync(supabase, user.id, orgId, connectorId, "info",
        `Connected to Klaviyo: ${validation.accountName}`);
    }

    return NextResponse.json({
      success: true,
      account_name: validation.accountName,
    });
  } catch (error) {
    console.error("Klaviyo connect error:", error);
    return NextResponse.json(
      { error: "Connection failed" },
      { status: 500 }
    );
  }
}
