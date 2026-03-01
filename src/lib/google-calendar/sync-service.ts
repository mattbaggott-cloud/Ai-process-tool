/**
 * Google Calendar Sync Service
 *
 * Syncs calendar events from Google Calendar API.
 * Logs CRM activities for events with known contacts as attendees.
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

interface CalendarEventAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
}

interface CalendarEventTime {
  dateTime?: string;
  date?: string;       // All-day events use date instead of dateTime
  timeZone?: string;
}

interface CalendarApiEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  status: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: CalendarEventAttendee[];
  recurrence?: string[];
  htmlLink?: string;
  created: string;
  updated: string;
}

/* ── Constants ─────────────────────────────────────────── */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_EVENTS = 1000;
const PAGE_SIZE = 250;

/* ── Public API ────────────────────────────────────────── */

/**
 * Sync events from the primary calendar.
 * Fetches events from the last 90 days to the next 30 days.
 */
export async function syncEvents(
  config: GoogleConnectorConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // Time range: 90 days ago → 30 days from now
  const now = new Date();
  const timeMin = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  let allEvents: CalendarApiEvent[] = [];
  let pageToken: string | undefined;

  while (allEvents.length < MAX_EVENTS) {
    const listUrl = new URL(`${CALENDAR_API}/calendars/primary/events`);
    listUrl.searchParams.set("maxResults", String(PAGE_SIZE));
    listUrl.searchParams.set("timeMin", timeMin);
    listUrl.searchParams.set("timeMax", timeMax);
    listUrl.searchParams.set("singleEvents", "true");
    listUrl.searchParams.set("orderBy", "startTime");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const res = await googleApiFetch(listUrl.toString(), config.access_token);
    const data = await res.json();

    const events = (data.items || []) as CalendarApiEvent[];
    allEvents.push(...events);

    pageToken = data.nextPageToken;
    if (!pageToken || events.length === 0) break;
  }

  // Upsert events in batches
  for (const event of allEvents) {
    try {
      const isAllDay = !event.start?.dateTime;
      const startTime = event.start?.dateTime || event.start?.date || null;
      const endTime = event.end?.dateTime || event.end?.date || null;

      const attendees = (event.attendees || []).map((a) => ({
        email: a.email || null,
        name: a.displayName || null,
        response_status: a.responseStatus || null,
        is_self: a.self || false,
        is_organizer: a.organizer || false,
      }));

      const row = {
        org_id: orgId,
        user_id: userId,
        external_id: event.id,
        calendar_id: "primary",
        summary: event.summary || null,
        description: event.description?.slice(0, 10000) || null,
        location: event.location || null,
        start_time: startTime,
        end_time: endTime,
        all_day: isAllDay,
        status: event.status || "confirmed",
        organizer_email: event.organizer?.email || null,
        attendees: JSON.stringify(attendees),
        recurrence: event.recurrence || [],
        html_link: event.htmlLink || null,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("calendar_events")
        .upsert(row, { onConflict: "org_id,external_id,calendar_id" });

      if (error) {
        console.error(`Calendar event upsert error for ${event.id}:`, error.message);
        result.errors++;
      } else {
        result.created++;
      }
    } catch (err) {
      console.error(`Calendar event processing error for ${event.id}:`, err);
      result.errors++;
    }
  }

  return result;
}

/**
 * For events with attendees matching known CRM contacts,
 * create crm_activities records with type='meeting'.
 */
export async function logActivities(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // Get all calendar events with attendees
  const { data: events } = await supabase
    .from("calendar_events")
    .select("id, external_id, summary, start_time, end_time, attendees, organizer_email")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .not("attendees", "is", null);

  if (!events || events.length === 0) return result;

  // Get all known contact emails
  const { data: contacts } = await supabase
    .from("crm_contacts")
    .select("id, email")
    .eq("org_id", orgId)
    .not("email", "is", null);

  if (!contacts || contacts.length === 0) return result;

  const contactByEmail = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) contactByEmail.set(c.email.toLowerCase(), c.id);
  }

  // Check which event-contact pairs already have activities
  const { data: existingActivities } = await supabase
    .from("crm_activities")
    .select("notes")
    .eq("org_id", orgId)
    .eq("type", "meeting")
    .ilike("notes", "%calendar_event_id:%");

  const loggedEventIds = new Set<string>();
  for (const a of existingActivities || []) {
    const match = (a.notes || "").match(/calendar_event_id:(\S+)/);
    if (match) loggedEventIds.add(match[1]);
  }

  for (const event of events) {
    if (loggedEventIds.has(event.external_id)) {
      result.skipped++;
      continue;
    }

    // Parse attendees and find matches
    let attendees: Array<{ email?: string | null }> = [];
    try {
      attendees =
        typeof event.attendees === "string"
          ? JSON.parse(event.attendees)
          : event.attendees || [];
    } catch {
      continue;
    }

    const matchedContactIds: string[] = [];
    for (const a of attendees) {
      if (a.email) {
        const contactId = contactByEmail.get(a.email.toLowerCase());
        if (contactId) matchedContactIds.push(contactId);
      }
    }

    if (matchedContactIds.length === 0) {
      result.skipped++;
      continue;
    }

    // Create activity for the first matched contact
    const { error } = await supabase.from("crm_activities").insert({
      org_id: orgId,
      user_id: userId,
      contact_id: matchedContactIds[0],
      type: "meeting",
      subject: event.summary || "Calendar meeting",
      notes: `Synced from Google Calendar. calendar_event_id:${event.external_id}`,
      activity_date: event.start_time || new Date().toISOString(),
    });

    if (error) {
      result.errors++;
    } else {
      result.created++;
    }
  }

  return result;
}

/**
 * Create a new event on the user's primary Google Calendar.
 */
export async function createCalendarEvent(
  config: GoogleConnectorConfig,
  params: {
    summary: string;
    description?: string;
    location?: string;
    startTime: string;       // ISO 8601 dateTime or date
    endTime: string;         // ISO 8601 dateTime or date
    allDay?: boolean;
    attendees?: string[];    // email addresses
  },
): Promise<{ id: string; htmlLink: string }> {
  const body: Record<string, unknown> = {
    summary: params.summary,
  };

  if (params.description) body.description = params.description;
  if (params.location) body.location = params.location;

  if (params.allDay) {
    // All-day events use date (YYYY-MM-DD), not dateTime
    body.start = { date: params.startTime.split("T")[0] };
    body.end = { date: params.endTime.split("T")[0] };
  } else {
    body.start = { dateTime: params.startTime };
    body.end = { dateTime: params.endTime };
  }

  if (params.attendees && params.attendees.length > 0) {
    body.attendees = params.attendees.map((email) => ({ email }));
  }

  const res = await googleApiFetch(
    `${CALENDAR_API}/calendars/primary/events`,
    config.access_token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink || "" };
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
