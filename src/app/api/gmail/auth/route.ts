import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl } from "@/lib/google/oauth";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.modify",
];

export async function GET(req: Request) {
  try {
    const baseUrl = new URL(req.url).origin;
    const state = randomUUID();
    const redirectUri = `${baseUrl}/api/gmail/callback`;

    const authUrl = buildGoogleAuthUrl({
      scopes: GMAIL_SCOPES,
      redirectUri,
      state,
      accessType: "offline",
      prompt: "consent",
    });

    const response = NextResponse.redirect(authUrl);

    response.cookies.set("gmail_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Gmail auth error:", error);
    return NextResponse.json(
      { error: "Gmail OAuth not configured" },
      { status: 500 },
    );
  }
}
