import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl } from "@/lib/google/oauth";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

export async function GET(req: Request) {
  try {
    const baseUrl = new URL(req.url).origin;
    const state = randomUUID();
    const redirectUri = `${baseUrl}/api/google-drive/callback`;

    const authUrl = buildGoogleAuthUrl({
      scopes: DRIVE_SCOPES,
      redirectUri,
      state,
      accessType: "offline",
      prompt: "consent",
    });

    const response = NextResponse.redirect(authUrl);

    response.cookies.set("gdrive_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Google Drive auth error:", error);
    return NextResponse.json(
      { error: "Google Drive OAuth not configured" },
      { status: 500 },
    );
  }
}
