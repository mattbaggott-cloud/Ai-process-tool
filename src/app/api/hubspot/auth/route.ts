import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || "";

// Required scopes — only the 6 core CRM scopes that every HubSpot account has
const SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "oauth",
].join(" ");

// Optional scopes — granted if the user's HubSpot plan supports them
const OPTIONAL_SCOPES = [
  "crm.schemas.deals.read",
  "crm.schemas.contacts.read",
  "crm.schemas.companies.read",
  "crm.schemas.forecasts.read",
  "crm.lists.read",
  "crm.lists.write",
  "crm.objects.owners.read",
  "crm.objects.line_items.read",
  "crm.objects.line_items.write",
  "crm.schemas.line_items.read",
  "crm.objects.custom.read",
  "crm.objects.custom.write",
  "crm.schemas.custom.read",
  "crm.objects.quotes.write",
  "crm.objects.quotes.read",
  "crm.schemas.quotes.read",
  "crm.import",
  "crm.export",
  "marketing-email",
  "automation",
  "timeline",
  "forms",
  "files",
  "tickets",
  "e-commerce",
  "content",
  "social",
  "sales-email-read",
  "transactional-email",
  "hubdb",
  "business-intelligence",
  "accounting",
  "actions",
  "integration-sync",
  "crm.objects.products.read",
  "crm.objects.products.write",
  "crm.objects.goals.write",
  "crm.objects.leads.read",
  "crm.objects.leads.write",
  "crm.objects.feedback_submissions.read",
  "crm.objects.marketing_events.read",
  "crm.objects.marketing_events.write",
  "crm.objects.subscriptions.write",
  "crm.schemas.subscriptions.write",
  "crm.schemas.invoices.write",
  "settings.users.read",
  "settings.users.write",
  "settings.users.teams.read",
  "settings.users.teams.write",
  "conversations.read",
  "conversations.write",
].join(" ");

export async function GET() {
  if (!HUBSPOT_CLIENT_ID || !HUBSPOT_REDIRECT_URI) {
    return NextResponse.json(
      { error: "HubSpot OAuth is not configured" },
      { status: 500 }
    );
  }

  const state = randomUUID();

  const authorizeUrl =
    `https://app.hubspot.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(HUBSPOT_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(HUBSPOT_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&optional_scope=${encodeURIComponent(OPTIONAL_SCOPES)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(authorizeUrl);

  response.cookies.set("hubspot_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
