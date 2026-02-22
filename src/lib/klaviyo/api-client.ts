/**
 * Shared Klaviyo API client — extracted from sync-service.ts for reuse
 * by both sync and send code.
 */

import type { KlaviyoConfig } from "@/lib/types/database";

/* ── Constants ─────────────────────────────────────────── */

export const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
export const KLAVIYO_REVISION = "2025-01-15";

/* ── API Fetch ─────────────────────────────────────────── */

export async function klaviyoFetch<T>(
  config: KlaviyoConfig,
  endpoint: string,
  options?: { method?: string; body?: unknown; url?: string }
): Promise<T> {
  const url = options?.url || `${KLAVIYO_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${config.api_key}`,
      revision: config.api_revision || KLAVIYO_REVISION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Klaviyo API ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

/* ── Config Loader ─────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Load Klaviyo config from data_connectors for a given org.
 * Returns null if no connected Klaviyo connector exists.
 */
export async function loadKlaviyoConfig(
  supabase: SupabaseClient,
  orgId: string
): Promise<KlaviyoConfig | null> {
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("config")
    .eq("org_id", orgId)
    .eq("connector_type", "klaviyo")
    .eq("status", "connected")
    .maybeSingle();

  if (!connector?.config) return null;
  return connector.config as unknown as KlaviyoConfig;
}
