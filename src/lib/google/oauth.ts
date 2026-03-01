/**
 * Shared Google OAuth 2.0 helper
 *
 * Used by Gmail, Google Calendar, and Google Drive connectors.
 * All three share the same GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * but request different scopes.
 */

import { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ─────────────────────────────────────────────── */

export interface GoogleConnectorConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in ms
  scopes: string[];
  email?: string; // user's Google email
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

/* ── Constants ─────────────────────────────────────────── */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v2/userinfo";

/** Buffer before token expiry to trigger refresh (5 minutes) */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/* ── Helpers ───────────────────────────────────────────── */

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return secret;
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Build the Google OAuth consent URL.
 * User is redirected here to grant permissions.
 */
export function buildGoogleAuthUrl(params: {
  scopes: string[];
  redirectUri: string;
  state: string;
  accessType?: "offline" | "online";
  prompt?: "consent" | "select_account" | "none";
}): string {
  const {
    scopes,
    redirectUri,
    state,
    accessType = "offline",
    prompt = "consent",
  } = params;

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", accessType);
  url.searchParams.set("prompt", prompt);
  // Include email scope so we can identify the user
  if (!scopes.includes("email")) {
    url.searchParams.set(
      "scope",
      [...scopes, "email", "profile"].join(" "),
    );
  }
  return url.toString();
}

/**
 * Exchange an authorization code for tokens.
 * Called from the OAuth callback route.
 */
export async function exchangeGoogleCode(params: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const { code, redirectUri } = params;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} — ${error}`);
  }

  return res.json() as Promise<GoogleTokenResponse>;
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} — ${error}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

/**
 * Check if a token is expired (with 5-minute buffer).
 */
export function isTokenExpired(expiresAt: number): boolean {
  return Date.now() + REFRESH_BUFFER_MS >= expiresAt;
}

/**
 * Fetch the authenticated user's Google profile info.
 */
export async function getGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google user info: ${res.status}`);
  }

  return res.json() as Promise<GoogleUserInfo>;
}

/**
 * Ensure the Google connector has a fresh access token.
 * If expired, refreshes and updates the connector row in Supabase.
 * Returns the (possibly updated) config.
 */
export async function ensureFreshGoogleToken(
  config: GoogleConnectorConfig,
  supabase: SupabaseClient,
  connectorId: string,
): Promise<GoogleConnectorConfig> {
  if (!isTokenExpired(config.expires_at)) {
    return config;
  }

  if (!config.refresh_token) {
    throw new Error("No refresh token available — user must re-authenticate");
  }

  const { access_token, expires_in } = await refreshGoogleToken(
    config.refresh_token,
  );

  const updated: GoogleConnectorConfig = {
    ...config,
    access_token,
    expires_at: Date.now() + expires_in * 1000,
  };

  // Persist the refreshed token
  await supabase
    .from("data_connectors")
    .update({
      config: updated as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectorId);

  return updated;
}

/**
 * Revoke a Google OAuth token (best-effort).
 * Called on disconnect. Failures are logged but not thrown.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Best-effort — token may already be invalid
    console.warn("Google token revocation failed (best-effort)");
  }
}

/**
 * Build a GoogleConnectorConfig from a token exchange response.
 */
export function buildGoogleConfig(
  tokens: GoogleTokenResponse,
  email?: string,
): GoogleConnectorConfig {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || "",
    expires_at: Date.now() + tokens.expires_in * 1000,
    scopes: tokens.scope.split(" "),
    email,
  };
}

/**
 * Make an authenticated GET request to a Google API.
 * Throws on non-2xx responses.
 */
export async function googleApiFetch(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Google API error ${res.status} for ${url}: ${body.slice(0, 500)}`,
    );
  }

  return res;
}
