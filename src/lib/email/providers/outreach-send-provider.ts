/**
 * Outreach Send Provider — implements EmailSendProvider for Outreach.io.
 *
 * In the Outreach model, "sending an email" means enrolling a prospect
 * in a sequence. Outreach then handles the actual email delivery,
 * follow-ups, and timing based on the sequence configuration.
 *
 * Requirements:
 *  - `sequence_id` must be set in the delivery config
 *  - Each variant's metadata must include `outreach_prospect_id`
 *    (the external_id from outreach_prospects)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshOutreachToken, type OutreachConfig } from "@/lib/outreach/sync-service";
import { enrollInOutreachSequence } from "@/lib/outreach/write-service";
import type {
  EmailSendProvider,
  SendOneParams,
  SendOneResult,
  DeliveryStatusResult,
} from "../send-provider";

/* ── Provider Implementation ──────────────────────────── */

export class OutreachSendProvider implements EmailSendProvider {
  name = "outreach";
  private supabase: SupabaseClient;
  private orgId: string;
  private sequenceId: string;

  constructor(config: Record<string, unknown>) {
    this.supabase = config.supabase as SupabaseClient;
    this.orgId = config.org_id as string;
    this.sequenceId = config.sequence_id as string;

    if (!this.supabase || !this.orgId) {
      throw new Error(
        "OutreachSendProvider requires supabase and org_id in config",
      );
    }
    if (!this.sequenceId) {
      throw new Error(
        "OutreachSendProvider requires sequence_id in delivery config. " +
        "Select an Outreach sequence when creating the campaign.",
      );
    }
  }

  /**
   * "Send" = enroll the prospect in the configured Outreach sequence.
   *
   * The `metadata.outreach_prospect_id` field is required — this is
   * the Outreach external ID from the `outreach_prospects` table.
   */
  async sendOne(params: SendOneParams): Promise<SendOneResult> {
    const prospectId = (params.metadata as Record<string, unknown>)
      ?.outreach_prospect_id as string | undefined;

    if (!prospectId) {
      throw new Error(
        `Cannot enroll in Outreach sequence: no outreach_prospect_id in metadata for ${params.to}. ` +
        "Ensure the contact has been synced to Outreach first.",
      );
    }

    // Load and refresh Outreach config
    const outreachConfig = await this.loadOutreachConfig();

    const result = await enrollInOutreachSequence(
      outreachConfig,
      prospectId,
      this.sequenceId,
    );

    return {
      messageId: result.sequenceStateId,
      status: "enrolled",
    };
  }

  /**
   * Outreach delivery status is managed by Outreach itself.
   * We don't have webhook integration yet, so return basic status.
   */
  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatusResult> {
    // Future: query Outreach API for sequenceState status
    return { status: "sent" };
  }

  /**
   * Batch delivery status — returns "sent" for all enrolled prospects.
   */
  async getBatchDeliveryStatus(
    messageIds: string[],
  ): Promise<Map<string, DeliveryStatusResult>> {
    const results = new Map<string, DeliveryStatusResult>();
    for (const id of messageIds) {
      results.set(id, { status: "sent" });
    }
    return results;
  }

  /* ── Private Helpers ────────────────────────────────── */

  /**
   * Load and refresh the Outreach OAuth config for this org.
   */
  private async loadOutreachConfig(): Promise<OutreachConfig> {
    const { data: connector, error } = await this.supabase
      .from("data_connectors")
      .select("id, config")
      .eq("org_id", this.orgId)
      .eq("connector_type", "outreach")
      .eq("status", "connected")
      .maybeSingle();

    if (error || !connector?.config) {
      throw new Error("Outreach is not connected. Please connect Outreach first.");
    }

    const config = connector.config as OutreachConfig;

    // Ensure token is fresh
    const freshConfig = await refreshOutreachToken(
      config,
      this.supabase,
      connector.id as string,
    );

    return freshConfig;
  }
}
