/**
 * Provider-agnostic email send interface.
 *
 * Our platform owns ALL intelligence (segmentation, per-customer content
 * generation, timing, orchestration). Email providers are "dumb pipes" —
 * they receive "send this HTML to this email address" and report back
 * delivery metrics.
 *
 * Supported providers:
 *  - Klaviyo (first implementation)
 *  - Mailchimp (future)
 *  - SendGrid (future)
 *  - Salesloft (future)
 */

import type { DeliveryChannel, DeliveryStatus } from "@/lib/types/database";

/* ── Types ─────────────────────────────────────────────── */

export interface SendOneParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: { name: string; email: string };
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface SendOneResult {
  messageId: string;
  status: string;
}

export interface DeliveryStatusResult {
  status: DeliveryStatus;
  delivered_at?: string;
  opened_at?: string;
  clicked_at?: string;
  bounced_at?: string;
}

/* ── Interface ─────────────────────────────────────────── */

export interface EmailSendProvider {
  /** Provider name for logging */
  name: string;

  /** Send a single email */
  sendOne(params: SendOneParams): Promise<SendOneResult>;

  /** Get delivery status for a single message */
  getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult>;

  /** Batch-check delivery status for multiple messages */
  getBatchDeliveryStatus(messageIds: string[]): Promise<Map<string, DeliveryStatusResult>>;
}

/* ── Factory ───────────────────────────────────────────── */

/**
 * Create a send provider for the given channel.
 * Config contains provider-specific settings (API keys, etc.)
 * loaded from the data_connectors table at runtime.
 */
export async function createSendProvider(
  channel: DeliveryChannel,
  config: Record<string, unknown>
): Promise<EmailSendProvider> {
  switch (channel) {
    case "klaviyo": {
      const { KlaviyoSendProvider } = await import("./providers/klaviyo-send-provider");
      return new KlaviyoSendProvider(config);
    }
    case "mailchimp":
      throw new Error("Mailchimp send provider not yet implemented");
    case "sendgrid":
      throw new Error("SendGrid send provider not yet implemented");
    case "salesloft":
      throw new Error("Salesloft send provider not yet implemented");
    default:
      throw new Error(`Unknown delivery channel: ${channel}`);
  }
}
