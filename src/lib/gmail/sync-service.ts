/**
 * Gmail Sync Service
 *
 * Syncs messages from Gmail API, extracts contacts for CRM.
 * Supports sending emails via Gmail API.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  type GoogleConnectorConfig,
  ensureFreshGoogleToken,
  googleApiFetch,
} from "@/lib/google/oauth";

/* ── Types ─────────────────────────────────────────────── */

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: GmailMessagePart[];
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailMessageHeader[];
    mimeType: string;
    body: { data?: string; size: number };
    parts?: GmailMessagePart[];
  };
}

/* ── Constants ─────────────────────────────────────────── */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES = 5000;
const BATCH_SIZE = 10;

/* ── Helpers ───────────────────────────────────────────── */

function getHeader(
  headers: GmailMessageHeader[],
  name: string,
): string | null {
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value || null;
}

function parseEmailAddresses(header: string | null): string[] {
  if (!header) return [];
  // Split on comma, extract email from "Name <email>" or just "email"
  return header
    .split(",")
    .map((s) => {
      const match = s.match(/<(.+?)>/);
      return (match ? match[1] : s).trim().toLowerCase();
    })
    .filter((e) => e.includes("@"));
}

function parseEmailName(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^(.+?)\s*<.+>/);
  return match ? match[1].replace(/"/g, "").trim() : null;
}

/**
 * Decode base64url-encoded Gmail body data.
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Extract plain text body from Gmail message payload.
 * Handles multipart and nested structures.
 */
function extractBody(payload: GmailApiMessage["payload"]): string {
  // Direct text/plain body
  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBase64Url(payload.body.data);
  }

  // Search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const nested = extractBody({
          ...payload,
          mimeType: part.mimeType,
          body: part.body,
          parts: part.parts,
        });
        if (nested) return nested;
      }
    }
  }

  return "";
}

/**
 * Check if a message has attachments.
 */
function hasAttachments(payload: GmailApiMessage["payload"]): boolean {
  if (payload.parts) {
    return payload.parts.some(
      (p) =>
        p.body?.size > 0 &&
        p.mimeType !== "text/plain" &&
        p.mimeType !== "text/html" &&
        !p.mimeType.startsWith("multipart/"),
    );
  }
  return false;
}

/* ── Live Search (queries Gmail API directly) ─────────── */

export interface GmailSearchResult {
  id: string;
  thread_id: string;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string;
  body_text: string;
  labels: string[];
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  internal_date: string;
}

/**
 * Search Gmail directly via the API — searches the ENTIRE mailbox in real-time.
 * Uses Gmail's native search engine (same as the Gmail search bar).
 *
 * @param config - Google OAuth config with access_token
 * @param gmailQuery - Gmail search query (supports from:, to:, subject:, has:attachment, etc.)
 * @param maxResults - Max results to return (default 20)
 * @returns Array of fully-hydrated message objects
 */
export async function searchGmailLive(
  config: GoogleConnectorConfig,
  gmailQuery: string,
  maxResults: number = 20,
): Promise<GmailSearchResult[]> {
  // Step 1: Search for matching message IDs using Gmail's search engine
  const listUrl = new URL(`${GMAIL_API}/messages`);
  listUrl.searchParams.set("q", gmailQuery);
  listUrl.searchParams.set("maxResults", String(Math.min(maxResults, 50)));

  const listRes = await googleApiFetch(listUrl.toString(), config.access_token);
  const listData = await listRes.json();

  const messageIds = ((listData.messages || []) as Array<{ id: string }>).map(
    (m) => m.id,
  );

  if (messageIds.length === 0) return [];

  // Step 2: Fetch full details for each matching message
  const results: GmailSearchResult[] = [];

  for (const msgId of messageIds) {
    try {
      const msgRes = await googleApiFetch(
        `${GMAIL_API}/messages/${msgId}?format=full`,
        config.access_token,
      );
      const msg = (await msgRes.json()) as GmailApiMessage;

      const headers = msg.payload.headers;
      const fromHeader = getHeader(headers, "From");

      results.push({
        id: msg.id,
        thread_id: msg.threadId,
        from_email: parseEmailAddresses(fromHeader)[0] || null,
        from_name: parseEmailName(fromHeader),
        to_emails: parseEmailAddresses(getHeader(headers, "To")),
        cc_emails: parseEmailAddresses(getHeader(headers, "Cc")),
        subject: getHeader(headers, "Subject"),
        snippet: msg.snippet,
        body_text: extractBody(msg.payload).slice(0, 50000),
        labels: msg.labelIds || [],
        is_read: !(msg.labelIds || []).includes("UNREAD"),
        is_starred: (msg.labelIds || []).includes("STARRED"),
        has_attachments: hasAttachments(msg.payload),
        internal_date: new Date(
          parseInt(msg.internalDate, 10),
        ).toISOString(),
      });
    } catch (err) {
      console.error(`[Gmail live search] Failed to fetch message ${msgId}:`, err);
    }
  }

  return results;
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Sync Gmail messages. Fetches recent messages and upserts to gmail_messages.
 */
export async function syncMessages(
  config: GoogleConnectorConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // List message IDs (paginated)
  let messageIds: string[] = [];
  let pageToken: string | undefined;

  while (messageIds.length < MAX_MESSAGES) {
    const listUrl = new URL(`${GMAIL_API}/messages`);
    listUrl.searchParams.set(
      "maxResults",
      String(Math.min(BATCH_SIZE, MAX_MESSAGES - messageIds.length)),
    );
    listUrl.searchParams.set("q", "newer_than:90d");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await googleApiFetch(listUrl.toString(), config.access_token);
    const listData = await listRes.json();

    const msgs = (listData.messages || []) as Array<{ id: string }>;
    messageIds.push(...msgs.map((m) => m.id));

    pageToken = listData.nextPageToken;
    if (!pageToken || msgs.length === 0) break;
  }

  // Fetch full message details in batches
  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);

    const fetchPromises = batch.map(async (msgId) => {
      try {
        const msgRes = await googleApiFetch(
          `${GMAIL_API}/messages/${msgId}?format=full`,
          config.access_token,
        );
        const msg = (await msgRes.json()) as GmailApiMessage;

        const headers = msg.payload.headers;
        const fromHeader = getHeader(headers, "From");
        const fromEmail = parseEmailAddresses(fromHeader)[0] || null;
        const fromName = parseEmailName(fromHeader);
        const toEmails = parseEmailAddresses(getHeader(headers, "To"));
        const ccEmails = parseEmailAddresses(getHeader(headers, "Cc"));
        const subject = getHeader(headers, "Subject");
        const bodyText = extractBody(msg.payload);

        const row = {
          org_id: orgId,
          user_id: userId,
          external_id: msg.id,
          thread_id: msg.threadId,
          from_email: fromEmail,
          from_name: fromName,
          to_emails: toEmails,
          cc_emails: ccEmails,
          subject,
          snippet: msg.snippet,
          body_text: bodyText.slice(0, 50000), // Limit body size
          labels: msg.labelIds || [],
          is_read: !(msg.labelIds || []).includes("UNREAD"),
          is_starred: (msg.labelIds || []).includes("STARRED"),
          has_attachments: hasAttachments(msg.payload),
          internal_date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
          synced_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("gmail_messages")
          .upsert(row, { onConflict: "org_id,external_id" });

        if (error) {
          console.error(`Gmail message upsert error for ${msgId}:`, error.message);
          result.errors++;
        } else {
          result.created++;
        }
      } catch (err) {
        console.error(`Gmail fetch error for message ${msgId}:`, err);
        result.errors++;
      }
    });

    await Promise.all(fetchPromises);

    // Rate-limit delay between batches to avoid Gmail API 429 errors
    if (i + BATCH_SIZE < messageIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return result;
}

/**
 * Extract unique contacts from synced Gmail messages and add to CRM.
 */
export async function extractContacts(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // Get all unique email addresses from gmail_messages
  const { data: messages } = await supabase
    .from("gmail_messages")
    .select("from_email, from_name, to_emails")
    .eq("org_id", orgId);

  if (!messages || messages.length === 0) return result;

  // Collect unique emails with their names
  const emailMap = new Map<string, string | null>();
  for (const msg of messages) {
    if (msg.from_email) {
      emailMap.set(msg.from_email, msg.from_name || emailMap.get(msg.from_email) || null);
    }
    for (const toEmail of msg.to_emails || []) {
      if (!emailMap.has(toEmail)) {
        emailMap.set(toEmail, null);
      }
    }
  }

  // Check which emails already exist in CRM
  const emails = Array.from(emailMap.keys());
  const { data: existingContacts } = await supabase
    .from("crm_contacts")
    .select("email")
    .eq("org_id", orgId)
    .in("email", emails);

  const existingEmails = new Set(
    (existingContacts || []).map((c) => c.email?.toLowerCase()),
  );

  // Create new contacts for unknown emails
  for (const [email, name] of emailMap) {
    if (existingEmails.has(email.toLowerCase())) {
      result.skipped++;
      continue;
    }

    // Split name into first/last
    const nameParts = name?.split(" ") || [];
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

    const { error } = await supabase.from("crm_contacts").insert({
      org_id: orgId,
      created_by: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      source: "gmail",
      status: "Active",
    });

    if (error) {
      // Likely duplicate — skip
      result.skipped++;
    } else {
      result.created++;
    }
  }

  return result;
}

/**
 * Send an email via Gmail API.
 *
 * Supports both plain-text and HTML content types.
 * When `contentType` is `"text/html"`, the email is sent as a multipart
 * message with both HTML and a plain-text fallback (stripped from HTML).
 */
export async function sendEmail(
  config: GoogleConnectorConfig,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  contentType: "text/plain" | "text/html" = "text/plain",
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let rawMessage: string;

    // Get the authenticated user's email for the From header
    let fromEmail = "";
    try {
      const profileRes = await googleApiFetch(
        `${GMAIL_API}/profile`,
        config.access_token,
        { method: "GET" },
      );
      const profile = await profileRes.json();
      fromEmail = profile.emailAddress || "";
    } catch {
      // If we can't get the profile, send without From — Gmail will fill it in
    }

    if (contentType === "text/html") {
      // Build multipart/alternative with HTML + plain-text fallback
      const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const textFallback = body
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const lines = [
        fromEmail ? `From: ${fromEmail}` : null,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        textFallback,
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
        `--${boundary}--`,
      ]
        .filter((line) => line !== null)
        .join("\r\n");

      rawMessage = lines;
    } else {
      // Simple text/plain message
      const lines = [
        fromEmail ? `From: ${fromEmail}` : null,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ]
        .filter((line) => line !== null)
        .join("\r\n");

      rawMessage = lines;
    }

    // Base64url encode
    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // googleApiFetch throws on non-200, so errors are caught below
    const res = await googleApiFetch(`${GMAIL_API}/messages/send`, config.access_token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });

    const data = await res.json();
    return { success: true, messageId: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    console.error("[Gmail sendEmail] Error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Log a sync event to data_sync_log.
 */
export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    connector_id: connectorId,
    event_type: eventType,
    message,
    details,
  });
}
