import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl } from "@/lib/google/oauth";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: Request) {
  try {
    const baseUrl = new URL(req.url).origin;
    const state = randomUUID();
    const redirectUri = `${baseUrl}/api/google-calendar/callback`;

    const authUrl = buildGoogleAuthUrl({
      scopes: CALENDAR_SCOPES,
      redirectUri,
      state,
      accessType: "offline",
      prompt: "consent",
    });

    const response = NextResponse.redirect(authUrl);

    response.cookies.set("gcal_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Google Calendar auth error:", error);
    return NextResponse.json(
      { error: "Google Calendar OAuth not configured" },
      { status: 500 },
    );
  }
}
