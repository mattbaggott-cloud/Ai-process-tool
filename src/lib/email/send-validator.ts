/**
 * Send Validation Engine — pre-send guardrails for campaign emails.
 *
 * Validates each variant before sending to catch:
 *  - Missing or invalid email addresses
 *  - Empty subject lines
 *  - Empty body content (HTML or text)
 *  - Unresolved {{variable}} template tokens
 *
 * Invalid variants are marked as failed with specific reasons in
 * delivery_metrics JSONB, so they appear in the failed sends list.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EmailCustomerVariant,
  ValidationFailureReason,
  SendValidationError,
} from "@/lib/types/database";

/* ── Single Variant Validation ────────────────────────── */

/** Simple email regex — catches most common issues */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Detects unresolved template variables like {{first_name}} */
const TEMPLATE_VAR_REGEX = /\{\{[^}]+\}\}/g;

/**
 * Validate a single variant for sending readiness.
 * Returns an array of failure reasons (empty = valid).
 */
export function validateVariantForSend(
  variant: Pick<
    EmailCustomerVariant,
    "customer_email" | "subject_line" | "body_html" | "body_text" | "edited_content" | "status"
  >,
): ValidationFailureReason[] {
  const failures: ValidationFailureReason[] = [];

  // Use edited content if the variant was edited
  const content =
    variant.status === "edited" && variant.edited_content
      ? (variant.edited_content as {
          subject_line?: string;
          body_html?: string;
          body_text?: string;
        })
      : variant;

  // 1. Email validation
  if (!variant.customer_email) {
    failures.push("missing_email");
  } else if (!EMAIL_REGEX.test(variant.customer_email)) {
    failures.push("invalid_email");
  }

  // 2. Subject line
  const subject = content.subject_line?.trim();
  if (!subject) {
    failures.push("empty_subject");
  }

  // 3. Body content (HTML or text)
  const html = content.body_html?.trim();
  const text = content.body_text?.trim();

  // Strip HTML tags to check if there's actual text content
  const htmlTextOnly = html
    ? html
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim()
    : "";

  if (!htmlTextOnly && !text) {
    failures.push("empty_body");
  }

  // 4. Unresolved template variables
  const allContent = [subject, html, text].filter(Boolean).join(" ");
  const unresolvedVars = allContent.match(TEMPLATE_VAR_REGEX);
  if (unresolvedVars && unresolvedVars.length > 0) {
    failures.push("missing_variables");
  }

  return failures;
}

/* ── Campaign-Level Validation ────────────────────────── */

export interface ValidationSummary {
  valid: EmailCustomerVariant[];
  invalid: SendValidationError[];
  totalChecked: number;
}

/**
 * Validate all approved/edited variants for a campaign before sending.
 *
 * - Loads all sendable variants (status = approved or edited)
 * - Validates each one
 * - Marks invalid variants as status='failed' with reasons in delivery_metrics
 * - Returns the split of valid vs. invalid
 */
export async function validateCampaignVariants(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string,
): Promise<ValidationSummary> {
  // Load approved/edited variants
  const { data: variants, error } = await supabase
    .from("email_customer_variants")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .in("status", ["approved", "edited"]);

  if (error) {
    throw new Error(`Failed to load variants for validation: ${error.message}`);
  }

  if (!variants || variants.length === 0) {
    return { valid: [], invalid: [], totalChecked: 0 };
  }

  const valid: EmailCustomerVariant[] = [];
  const invalid: SendValidationError[] = [];

  for (const rawVariant of variants) {
    const variant = rawVariant as unknown as EmailCustomerVariant;
    const failures = validateVariantForSend(variant);

    if (failures.length === 0) {
      valid.push(variant);
    } else {
      invalid.push({
        variant_id: variant.id,
        customer_email: variant.customer_email,
        customer_name: variant.customer_name,
        reasons: failures,
      });

      // Mark variant as failed with reasons
      await supabase
        .from("email_customer_variants")
        .update({
          status: "failed",
          delivery_status: "failed",
          delivery_metrics: {
            validation_failures: failures,
            failed_at: new Date().toISOString(),
            failure_type: "pre_send_validation",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", variant.id);
    }
  }

  return {
    valid,
    invalid,
    totalChecked: variants.length,
  };
}
