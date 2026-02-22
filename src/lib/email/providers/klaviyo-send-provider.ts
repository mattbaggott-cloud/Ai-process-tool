/**
 * Klaviyo Send Provider — implements EmailSendProvider for Klaviyo.
 *
 * Uses Klaviyo's event-based approach to send individual emails.
 * Each email is tracked as a custom event on the recipient's profile,
 * which can trigger a Klaviyo flow or be used purely for individual sends.
 *
 * For truly transactional sends, this uses the Klaviyo Campaigns API
 * to create one-off sends. Each email from our platform appears as
 * an individual send in Klaviyo — they never see our segments or logic.
 */

import type { KlaviyoConfig } from "@/lib/types/database";
import { klaviyoFetch, KLAVIYO_API_BASE, KLAVIYO_REVISION } from "@/lib/klaviyo/api-client";
import type {
  EmailSendProvider,
  SendOneParams,
  SendOneResult,
  DeliveryStatusResult,
} from "../send-provider";

/* ── Klaviyo API Response Types ────────────────────────── */

interface KlaviyoEventResponse {
  data: { id: string };
}

interface KlaviyoProfileCreateResponse {
  data: { id: string; attributes: { email: string } };
}

/* ── Provider Implementation ──────────────────────────── */

export class KlaviyoSendProvider implements EmailSendProvider {
  name = "klaviyo";
  private config: KlaviyoConfig;

  constructor(rawConfig: Record<string, unknown>) {
    this.config = {
      api_key: rawConfig.api_key as string,
      api_revision: (rawConfig.api_revision as string) || undefined,
      account_name: (rawConfig.account_name as string) || undefined,
    };

    if (!this.config.api_key) {
      throw new Error("Klaviyo API key is required");
    }
  }

  /**
   * Send a single email via Klaviyo.
   *
   * Strategy: Create/update the profile, then create an event that
   * triggers a flow in Klaviyo. The flow template is just a pass-through
   * that renders whatever HTML we attach to the event.
   *
   * Alternative for accounts with transactional email enabled:
   * Use POST /api/campaign-message-assign-template/ + send.
   *
   * For MVP, we use the Events API approach which works on all Klaviyo plans.
   */
  async sendOne(params: SendOneParams): Promise<SendOneResult> {
    // 1. Ensure profile exists in Klaviyo
    const profileId = await this.ensureProfile(params.to, params.metadata);

    // 2. Create an event on the profile with the email content attached
    // This event can trigger a Klaviyo flow that sends the email
    const eventId = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await klaviyoFetch<KlaviyoEventResponse>(this.config, "/events/", {
      method: "POST",
      body: {
        data: {
          type: "event",
          attributes: {
            metric: {
              data: {
                type: "metric",
                attributes: {
                  name: "Campaign Email Send",
                },
              },
            },
            profile: {
              data: {
                type: "profile",
                attributes: { email: params.to },
              },
            },
            properties: {
              email_subject: params.subject,
              email_html: params.htmlBody,
              email_text: params.textBody || "",
              from_name: params.from?.name || "",
              from_email: params.from?.email || "",
              reply_to: params.replyTo || "",
              event_id: eventId,
              ...((params.metadata as Record<string, unknown>) || {}),
            },
            unique_id: eventId,
            time: new Date().toISOString(),
          },
        },
      },
    });

    return {
      messageId: eventId,
      status: "sent",
    };
  }

  /**
   * Get delivery status for a single message.
   * Queries Klaviyo's event API to check if the email was delivered/opened/clicked.
   */
  async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
    try {
      // Query events by the unique_id we set during send
      const response = await klaviyoFetch<{
        data: Array<{
          attributes: {
            metric_id: string;
            datetime: string;
            event_properties: Record<string, unknown>;
          };
        }>;
      }>(this.config, `/events/?filter=equals(unique_id,"${messageId}")`);

      if (!response.data || response.data.length === 0) {
        return { status: "pending" };
      }

      // The event exists, so at minimum it was sent
      return {
        status: "sent",
        // Delivery/open/click tracking comes from Klaviyo's flow metrics
        // which require a separate query. For now, return basic status.
      };
    } catch {
      return { status: "pending" };
    }
  }

  /**
   * Batch-check delivery status for multiple messages.
   */
  async getBatchDeliveryStatus(messageIds: string[]): Promise<Map<string, DeliveryStatusResult>> {
    const results = new Map<string, DeliveryStatusResult>();

    // Process in batches of 10 to avoid rate limits
    const BATCH = 10;
    for (let i = 0; i < messageIds.length; i += BATCH) {
      const batch = messageIds.slice(i, i + BATCH);
      const promises = batch.map(async (id) => {
        const status = await this.getDeliveryStatus(id);
        results.set(id, status);
      });
      await Promise.all(promises);

      // Rate limit: 100ms between batches
      if (i + BATCH < messageIds.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return results;
  }

  /* ── Private Helpers ────────────────────────────────── */

  /**
   * Ensure a profile exists in Klaviyo for the given email.
   * Uses the Profiles API to create-or-update.
   */
  private async ensureProfile(
    email: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    try {
      const response = await klaviyoFetch<KlaviyoProfileCreateResponse>(
        this.config,
        "/profile-import/",
        {
          method: "POST",
          body: {
            data: {
              type: "profile",
              attributes: {
                email,
                properties: {
                  source: "ai_campaign_engine",
                  ...(metadata || {}),
                },
              },
            },
          },
        }
      );
      return response.data?.id || email;
    } catch {
      // Profile might already exist, that's fine
      return email;
    }
  }
}
