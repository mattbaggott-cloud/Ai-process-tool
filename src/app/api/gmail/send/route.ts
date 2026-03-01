import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org";
import {
  type GoogleConnectorConfig,
  ensureFreshGoogleToken,
} from "@/lib/google/oauth";
import { sendEmail } from "@/lib/gmail/sync-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const orgCtx = await getOrgContext(supabase);

  if (!orgCtx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user } = orgCtx;

  let body: { to: string; subject: string; body: string; cc?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.to || !body.subject || !body.body) {
    return NextResponse.json(
      { error: "Missing required fields: to, subject, body" },
      { status: 400 },
    );
  }

  // Load the Gmail connector
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("connector_type", "gmail")
    .eq("status", "connected")
    .single();

  if (!connector) {
    return NextResponse.json(
      { error: "Gmail is not connected" },
      { status: 400 },
    );
  }

  const config = connector.config as unknown as GoogleConnectorConfig;

  try {
    // Refresh token if needed
    const freshConfig = await ensureFreshGoogleToken(
      config,
      supabase,
      connector.id,
    );

    const result = await sendEmail(
      freshConfig,
      body.to,
      body.subject,
      body.body,
      body.cc,
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Send failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Gmail send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Send failed" },
      { status: 500 },
    );
  }
}
