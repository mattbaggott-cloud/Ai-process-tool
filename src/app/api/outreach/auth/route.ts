import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

const OUTREACH_AUTH_URL = "https://api.outreach.io/oauth/authorize";
const OUTREACH_SCOPES = [
  "prospects.read",
  "prospects.write",
  "sequences.read",
  "sequenceStates.write",
  "tasks.read",
  "tasks.write",
  "accounts.read",
];

function getOutreachClientId(): string {
  const id = process.env.OUTREACH_CLIENT_ID;
  if (!id) throw new Error("OUTREACH_CLIENT_ID is not set");
  return id;
}

export async function GET(req: Request) {
  try {
    const baseUrl = new URL(req.url).origin;
    const state = randomUUID();
    const redirectUri = `${baseUrl}/api/outreach/callback`;

    const url = new URL(OUTREACH_AUTH_URL);
    url.searchParams.set("client_id", getOutreachClientId());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OUTREACH_SCOPES.join(" "));
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url.toString());

    response.cookies.set("outreach_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Outreach auth error:", error);
    return NextResponse.json(
      { error: "Outreach OAuth not configured" },
      { status: 500 },
    );
  }
}
