/**
 * Campaign Engine — the heart of the AI Campaign system.
 *
 * Orchestrates everything:
 *  - Campaign creation (per_customer, broadcast, sequence)
 *  - Per-customer variant generation via Claude (batched)
 *  - Template wrapping with brand assets
 *  - Sending through provider-agnostic interface
 *  - Status tracking and metrics
 *
 * Our platform owns ALL intelligence. Email providers are dumb pipes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type {
  EmailCampaign,
  EmailCustomerVariant,
  CampaignType,
  CampaignEmailType,
  DeliveryChannel,
  EmailBrandAsset,
  CampaignStrategyGroup,
  StrategySequenceStep,
  ExecutionMode,
  StepType,
  CampaignCategory,
  SendSchedule,
} from "@/lib/types/database";
import { createSendProvider, type EmailSendProvider } from "./send-provider";
import { validateCampaignVariants } from "./send-validator";
import { logCampaignSend } from "./campaign-activity-logger";
import { loadKlaviyoConfig } from "@/lib/klaviyo/api-client";

/* ── Types ─────────────────────────────────────────────── */

export interface CreateCampaignInput {
  name: string;
  campaignType: CampaignType;
  segmentId?: string;
  customerIds?: string[];
  emailType: CampaignEmailType;
  prompt: string;
  templateId?: string;
  deliveryChannel?: DeliveryChannel;
  executionMode?: ExecutionMode;
  stepType?: StepType;
  campaignCategory?: CampaignCategory;
  sendSchedule?: SendSchedule;
}

export interface CreateCampaignResult {
  campaignId: string;
  name: string;
  status: string;
  segmentName: string | null;
  segmentId: string | null;
  customerCount: number;
}

export interface GenerateVariantsResult {
  campaignId: string;
  totalGenerated: number;
  status: string;
  skippedNoEmail?: number;
}

export interface SendCampaignResult {
  campaignId: string;
  sent: number;
  failed: number;
  status: string;
}

export interface CampaignStatusResult {
  id: string;
  name: string;
  campaignType: CampaignType;
  status: string;
  emailType: CampaignEmailType;
  deliveryChannel: DeliveryChannel;
  segmentName: string | null;
  total: number;
  draft: number;
  approved: number;
  edited: number;
  rejected: number;
  sending: number;
  sent: number;
  failed: number;
  deliveryMetrics: {
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
  };
}

/** Per-customer context used for generation */
interface CustomerContext {
  customerId: string;
  email: string;
  name: string;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  products: Array<{ title: string; quantity: number; price: number }>;
  lifecycleStage: string | null;
  commStyle: string | null;
  intervalTrend: string | null;
  predictedNextPurchase: string | null;
  daysUntilPredicted: number | null;
  rfm: { recency: number | null; frequency: number | null; monetary: number | null };
  topProductType: string | null;
  topProductTitle: string | null;
  productAffinities: Array<{ title: string; count: number }>;
}

/** Progress callback for streaming generation updates */
export type GenerationProgressCallback = (event: {
  type: "progress" | "variant_complete" | "done" | "error";
  current?: number;
  total?: number;
  customerEmail?: string;
  error?: string;
}) => void;

/* ── Constants ─────────────────────────────────────────── */

const BATCH_SIZE = 5; // customers per Claude API call
const SEND_CONCURRENCY = 5; // parallel sends
const GENERATION_MODEL = "claude-sonnet-4-20250514";
const RATE_LIMIT_INITIAL_DELAY = 15_000; // 15s initial backoff on 429
const RATE_LIMIT_MAX_RETRIES = 5;

/** Check if campaign has been cancelled or paused — called before each batch */
async function shouldStop(supabase: SupabaseClient, campaignId: string): Promise<"cancelled" | "paused" | false> {
  const { data } = await supabase
    .from("email_campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();
  const status = data?.status as string;
  if (status === "cancelled") return "cancelled";
  if (status === "paused") return "paused";
  return false;
}

/** Load set of customer IDs that already have variants for this campaign + step */
async function loadExistingVariantCustomerIds(
  supabase: SupabaseClient,
  campaignId: string,
  strategyGroupId?: string,
  stepNumber?: number
): Promise<Set<string>> {
  let query = supabase
    .from("email_customer_variants")
    .select("ecom_customer_id")
    .eq("campaign_id", campaignId);

  if (strategyGroupId) query = query.eq("strategy_group_id", strategyGroupId);
  if (stepNumber !== undefined) query = query.eq("step_number", stepNumber);

  const { data } = await query;
  return new Set((data ?? []).map((d) => d.ecom_customer_id as string));
}

/* ── Retry with backoff (for rate limits) ──────────────── */

async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let delay = RATE_LIMIT_INITIAL_DELAY;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 =
        (err instanceof Error && err.message.includes("429")) ||
        (typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 429);

      if (is429 && attempt < RATE_LIMIT_MAX_RETRIES) {
        // Check for retry-after header hint in error message
        const retryAfterMatch = err instanceof Error ? err.message.match(/retry.after[:\s]*(\d+)/i) : null;
        const waitMs = retryAfterMatch ? parseInt(retryAfterMatch[1]) * 1000 : delay;

        console.log(`[Campaign] Rate limited on ${label}, attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}. Waiting ${Math.round(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
        delay *= 2; // exponential backoff
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: max retries exceeded`);
}

/* ── Campaign CRUD ─────────────────────────────────────── */

/**
 * Create a new campaign record. If segmentId is provided, validate it.
 * If no segmentId, campaign targets the full customer list (AI handles sub-grouping).
 */
export async function createCampaign(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: CreateCampaignInput
): Promise<CreateCampaignResult> {
  let segmentName: string | null = null;
  let customerCount = 0;
  let autoSegmentId: string | undefined;

  if (input.customerIds && input.customerIds.length > 0) {
    // Explicit customer IDs from a data query — create an auto-segment
    const { data: autoSegment, error: segCreateErr } = await supabase
      .from("segments")
      .insert({
        org_id: orgId,
        name: `Auto: ${input.name}`,
        description: `Auto-created for campaign targeting ${input.customerIds.length} specific customers`,
        segment_type: "manual",
        rules: { type: "rule", field: "id", operator: "in", value: "direct" },
        customer_count: input.customerIds.length,
        status: "active",
      })
      .select("id")
      .single();

    if (segCreateErr || !autoSegment) {
      throw new Error(`Failed to create auto-segment: ${segCreateErr?.message}`);
    }

    autoSegmentId = autoSegment.id as string;

    // Populate segment members in batches
    const memberRows = input.customerIds.map((custId) => ({
      org_id: orgId,
      segment_id: autoSegmentId!,
      ecom_customer_id: custId,
    }));
    for (let i = 0; i < memberRows.length; i += 500) {
      await supabase.from("segment_members").insert(memberRows.slice(i, i + 500));
    }

    segmentName = `${input.customerIds.length} targeted customers`;
    customerCount = input.customerIds.length;
  } else if (input.segmentId) {
    // Validate segment exists
    const { data: segment, error: segErr } = await supabase
      .from("segments")
      .select("id, name, customer_count")
      .eq("id", input.segmentId)
      .eq("org_id", orgId)
      .single();

    if (segErr || !segment) {
      throw new Error(`Segment not found: ${input.segmentId}`);
    }
    segmentName = segment.name as string;
    customerCount = (segment.customer_count as number) || 0;
  } else {
    // No segment — count all customers
    const { count } = await supabase
      .from("ecom_customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    customerCount = count ?? 0;
  }

  // Resolve delivery config from data_connectors
  const channel = input.deliveryChannel || "klaviyo";
  const deliveryConfig = await resolveDeliveryConfig(supabase, orgId, channel);

  // Create campaign record
  const { data: campaign, error: createErr } = await supabase
    .from("email_campaigns")
    .insert({
      org_id: orgId,
      name: input.name,
      campaign_type: input.campaignType,
      segment_id: autoSegmentId ?? input.segmentId ?? null,
      status: "draft",
      email_type: input.emailType,
      prompt_used: input.prompt,
      delivery_channel: channel,
      delivery_config: deliveryConfig,
      template_id: input.templateId ?? null,
      execution_mode: input.executionMode || "automatic",
      campaign_category: input.campaignCategory || "marketing",
      send_schedule: input.sendSchedule || {},
      created_by: userId,
    })
    .select()
    .single();

  if (createErr || !campaign) {
    throw new Error(`Failed to create campaign: ${createErr?.message}`);
  }

  return {
    campaignId: campaign.id as string,
    name: input.name,
    status: "draft",
    segmentName,
    segmentId: (autoSegmentId ?? input.segmentId ?? null) as string | null,
    customerCount,
  };
}

/**
 * Generate per-customer email variants for a campaign.
 * This is the core intelligence — each customer gets a unique email
 * based on their purchase history, behavioral profile, etc.
 */
export async function generateCampaignVariants(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string,
  onProgress?: GenerationProgressCallback
): Promise<GenerateVariantsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  // Load campaign
  const { data: campaign, error: campErr } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (campErr || !campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const camp = campaign as unknown as EmailCampaign;

  // Update status to generating
  await supabase
    .from("email_campaigns")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", campaignId);

  try {
    // Load brand assets / template
    const brandAssets = await loadBrandAssets(supabase, orgId, camp.template_id);

    // Load org context
    const { data: org } = await supabase
      .from("org_profiles")
      .select("name, description, industry, target_market")
      .eq("org_id", orgId)
      .single();

    // Load customer contexts — from segment if available, otherwise all customers
    // Also count the total before email filtering so we can report skipped customers
    let totalCustomersBefore = 0;
    if (camp.segment_id) {
      const { count } = await supabase
        .from("segment_members")
        .select("*", { count: "exact", head: true })
        .eq("segment_id", camp.segment_id);
      totalCustomersBefore = count ?? 0;
    } else {
      const { count } = await supabase
        .from("ecom_customers")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      totalCustomersBefore = count ?? 0;
    }

    const customers = camp.segment_id
      ? await loadSegmentCustomerContexts(supabase, orgId, camp.segment_id)
      : await loadAllCustomerContexts(supabase, orgId);

    const skippedNoEmail = totalCustomersBefore - customers.length;

    if (customers.length === 0) {
      await supabase
        .from("email_campaigns")
        .update({ status: "review", total_variants: 0, updated_at: new Date().toISOString() })
        .eq("id", campaignId);
      return { campaignId, totalGenerated: 0, status: "review", skippedNoEmail: skippedNoEmail > 0 ? skippedNoEmail : undefined };
    }

    onProgress?.({ type: "progress", current: 0, total: customers.length });

    let totalGenerated = 0;
    const anthropic = new Anthropic();

    if (camp.campaign_type === "broadcast") {
      // Check for cancellation/pause before starting
      const stopReason0 = await shouldStop(supabase, campaignId);
      if (stopReason0) {
        onProgress?.({ type: "error", error: `Campaign generation ${stopReason0}` });
        return { campaignId, totalGenerated: 0, status: stopReason0 };
      }

      // Broadcast: generate ONE email, clone to all customers
      const singleEmail = await withRateLimitRetry(
        () => generateBroadcastEmail(
          anthropic,
          camp,
          org as Record<string, unknown> | null,
          brandAssets,
          customers
        ),
        "broadcast email"
      );

      // Create a variant for each customer
      const variants = customers.map((c) => ({
        org_id: orgId,
        campaign_id: campaignId,
        ecom_customer_id: c.customerId,
        customer_email: c.email,
        customer_name: c.name,
        subject_line: singleEmail.subject_line,
        preview_text: singleEmail.preview_text,
        body_html: singleEmail.body_html,
        body_text: singleEmail.body_text,
        personalization_context: { type: "broadcast" },
        status: "draft" as const,
      }));

      // Insert in batches of 50
      for (let i = 0; i < variants.length; i += 50) {
        const batch = variants.slice(i, i + 50);
        await supabase.from("email_customer_variants").insert(batch);
      }

      totalGenerated = customers.length;
      onProgress?.({ type: "done", current: totalGenerated, total: customers.length });
    } else if (camp.has_strategy) {
      // Strategy-based: generate per-group, per-step
      const { data: strategyGroups } = await supabase
        .from("campaign_strategy_groups")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order", { ascending: true });

      if (!strategyGroups || strategyGroups.length === 0) {
        throw new Error("Campaign has strategy flag but no strategy groups found");
      }

      // Count total emails across all groups × steps
      const totalEmails = (strategyGroups as unknown as CampaignStrategyGroup[]).reduce(
        (sum, g) => sum + g.customer_count * (g.sequence_steps?.length || 1), 0
      );

      onProgress?.({ type: "progress", current: 0, total: totalEmails });

      for (const rawGroup of strategyGroups) {
        // Check for cancellation/pause before each group
        const stopReasonG = await shouldStop(supabase, campaignId);
        if (stopReasonG) {
          onProgress?.({ type: "error", error: `Campaign generation ${stopReasonG}` });
          await supabase.from("email_campaigns").update({ total_variants: totalGenerated, updated_at: new Date().toISOString() }).eq("id", campaignId);
          return { campaignId, totalGenerated, status: stopReasonG };
        }

        const group = rawGroup as unknown as CampaignStrategyGroup;
        const groupCustomerIds = new Set(group.customer_ids || []);
        const groupCustomers = customers.filter((c) => groupCustomerIds.has(c.customerId));
        const steps = group.sequence_steps || [{ step_number: 1, delay_days: 0, email_type: camp.email_type, prompt: camp.prompt_used || "" }];

        // Update group status
        await supabase
          .from("campaign_strategy_groups")
          .update({ status: "generating", updated_at: new Date().toISOString() })
          .eq("id", group.id);

        for (const step of steps) {
          // Override campaign prompt with step-specific prompt for generation
          const stepCamp = {
            ...camp,
            prompt_used: step.prompt,
            email_type: (step.email_type || camp.email_type) as CampaignEmailType,
          };

          // Skip customers who already have variants for this group+step (resume support)
          const existingIds = await loadExistingVariantCustomerIds(supabase, campaignId, group.id, step.step_number);
          const remainingCustomers = groupCustomers.filter((c) => !existingIds.has(c.customerId));
          totalGenerated += existingIds.size; // Count previously generated

          for (let i = 0; i < remainingCustomers.length; i += BATCH_SIZE) {
            // Check for cancellation/pause before each batch
            const stopReasonB = await shouldStop(supabase, campaignId);
            if (stopReasonB) {
              onProgress?.({ type: "error", error: `Campaign generation ${stopReasonB}` });
              await supabase.from("email_campaigns").update({ total_variants: totalGenerated, updated_at: new Date().toISOString() }).eq("id", campaignId);
              return { campaignId, totalGenerated, status: stopReasonB };
            }

            const batch = remainingCustomers.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(remainingCustomers.length / BATCH_SIZE);

            const generatedEmails = await withRateLimitRetry(
              () => generateBatchedEmails(
                anthropic,
                stepCamp,
                org as Record<string, unknown> | null,
                brandAssets,
                batch
              ),
              `group "${group.group_name}" step ${step.step_number} batch ${batchNum}/${totalBatches}`
            );

            if (i + BATCH_SIZE < groupCustomers.length) {
              await new Promise((r) => setTimeout(r, 2000));
            }

            for (let j = 0; j < generatedEmails.length; j++) {
              const email = generatedEmails[j];
              const customer = batch[j];
              if (!customer || !email) continue;

              await supabase.from("email_customer_variants").insert({
                org_id: orgId,
                campaign_id: campaignId,
                strategy_group_id: group.id,
                step_number: step.step_number,
                ecom_customer_id: customer.customerId,
                customer_email: customer.email,
                customer_name: customer.name,
                subject_line: email.subject_line,
                preview_text: email.preview_text,
                body_html: email.body_html,
                body_text: email.body_text,
                personalization_context: {
                  group_name: group.group_name,
                  step_number: step.step_number,
                  delay_days: step.delay_days,
                  ordersCount: customer.ordersCount,
                  totalSpent: customer.totalSpent,
                  lastOrderAt: customer.lastOrderAt,
                  lifecycleStage: customer.lifecycleStage,
                  commStyle: customer.commStyle,
                  topProducts: customer.products.slice(0, 5).map((p) => p.title),
                  rfm: customer.rfm,
                },
                status: "draft",
              });

              totalGenerated++;
              onProgress?.({
                type: "variant_complete",
                current: totalGenerated,
                total: totalEmails,
                customerEmail: customer.email,
              });
            }

            await supabase
              .from("email_campaigns")
              .update({
                total_variants: totalGenerated,
                stats: { generating_progress: totalGenerated, generating_total: totalEmails },
                updated_at: new Date().toISOString(),
              })
              .eq("id", campaignId);
          }
        }

        // Update group status to review
        await supabase
          .from("campaign_strategy_groups")
          .update({ status: "review", updated_at: new Date().toISOString() })
          .eq("id", group.id);
      }

      onProgress?.({ type: "done", current: totalGenerated, total: totalEmails });
    } else {
      // Per-customer (no strategy): generate UNIQUE email per customer using batched Claude calls
      // Skip customers who already have variants (resume support)
      const existingNonStrategyIds = await loadExistingVariantCustomerIds(supabase, campaignId);
      const remainingNonStrategy = customers.filter((c) => !existingNonStrategyIds.has(c.customerId));
      totalGenerated += existingNonStrategyIds.size;

      for (let i = 0; i < remainingNonStrategy.length; i += BATCH_SIZE) {
        // Check for cancellation/pause before each batch
        const stopReasonNS = await shouldStop(supabase, campaignId);
        if (stopReasonNS) {
          onProgress?.({ type: "error", error: `Campaign generation ${stopReasonNS}` });
          await supabase.from("email_campaigns").update({ total_variants: totalGenerated, updated_at: new Date().toISOString() }).eq("id", campaignId);
          return { campaignId, totalGenerated, status: stopReasonNS };
        }

        const batch = remainingNonStrategy.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(remainingNonStrategy.length / BATCH_SIZE);

        const generatedEmails = await withRateLimitRetry(
          () => generateBatchedEmails(
            anthropic,
            camp,
            org as Record<string, unknown> | null,
            brandAssets,
            batch
          ),
          `batch ${batchNum}/${totalBatches}`
        );

        // Pace batches to avoid rate limits (2s between batches)
        if (i + BATCH_SIZE < customers.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Save each variant
        for (let j = 0; j < generatedEmails.length; j++) {
          const email = generatedEmails[j];
          const customer = batch[j];
          if (!customer || !email) continue;

          await supabase.from("email_customer_variants").insert({
            org_id: orgId,
            campaign_id: campaignId,
            ecom_customer_id: customer.customerId,
            customer_email: customer.email,
            customer_name: customer.name,
            subject_line: email.subject_line,
            preview_text: email.preview_text,
            body_html: email.body_html,
            body_text: email.body_text,
            personalization_context: {
              ordersCount: customer.ordersCount,
              totalSpent: customer.totalSpent,
              lastOrderAt: customer.lastOrderAt,
              lifecycleStage: customer.lifecycleStage,
              commStyle: customer.commStyle,
              topProducts: customer.products.slice(0, 5).map((p) => p.title),
              rfm: customer.rfm,
            },
            status: "draft",
          });

          totalGenerated++;
          onProgress?.({
            type: "variant_complete",
            current: totalGenerated,
            total: customers.length,
            customerEmail: customer.email,
          });
        }

        // Update campaign progress after each batch so UI can show live count
        await supabase
          .from("email_campaigns")
          .update({
            total_variants: totalGenerated,
            stats: { generating_progress: totalGenerated, generating_total: customers.length },
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);
      }

      onProgress?.({ type: "done", current: totalGenerated, total: customers.length });
    }

    // Update campaign
    await supabase
      .from("email_campaigns")
      .update({
        status: "review",
        total_variants: totalGenerated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return { campaignId, totalGenerated, status: "review", skippedNoEmail: skippedNoEmail > 0 ? skippedNoEmail : undefined };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("email_campaigns")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    onProgress?.({ type: "error", error: errorMsg });
    throw err;
  }
}

/**
 * Send all approved/edited variants through the delivery provider.
 *
 * Multi-channel orchestration:
 *  - Validates all variants before sending (catches empty content, bad emails, etc.)
 *  - Routes each variant through the correct provider based on per-step channel
 *  - If execution_mode is "manual", creates tasks instead of sending
 *  - Non-email step types always create tasks regardless of mode
 *  - Logs sends to CRM activities + knowledge graph for unified timeline
 */
export async function sendCampaign(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  campaignId: string
): Promise<SendCampaignResult> {
  // Load campaign
  const { data: campaign, error: campErr } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (campErr || !campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const camp = campaign as unknown as EmailCampaign;

  if (!["review", "approved"].includes(camp.status)) {
    throw new Error(`Campaign is not ready to send (status: ${camp.status})`);
  }

  // ── Step 1: Validate all variants ──
  const validation = await validateCampaignVariants(supabase, orgId, campaignId);

  if (validation.valid.length === 0 && validation.invalid.length > 0) {
    await supabase
      .from("email_campaigns")
      .update({
        status: "failed",
        failed_count: validation.invalid.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    throw new Error(
      `All ${validation.invalid.length} variants failed validation. ` +
      "Use get_failed_sends to see specific issues."
    );
  }

  const typedVariants = validation.valid;

  // ── Step 2: Check execution mode ──
  const executionMode = camp.execution_mode || "automatic";

  if (executionMode === "manual") {
    // Manual mode: create tasks for each variant instead of sending
    return await createTasksForVariants(supabase, orgId, userId, campaignId, camp, typedVariants);
  }

  // ── Step 3: Load strategy groups for per-step channel routing ──
  const stepChannelMap = new Map<string, DeliveryChannel>();
  const stepTypeMap = new Map<string, StepType>();

  if (camp.has_strategy) {
    const { data: groups } = await supabase
      .from("campaign_strategy_groups")
      .select("id, sequence_steps")
      .eq("campaign_id", campaignId);

    for (const group of (groups || []) as unknown as CampaignStrategyGroup[]) {
      for (const step of (group.sequence_steps || [])) {
        const key = `${group.id}_${step.step_number}`;
        if (step.channel) stepChannelMap.set(key, step.channel);
        if (step.step_type) stepTypeMap.set(key, step.step_type);
      }
    }
  }

  // ── Step 4: Build provider cache (channel → provider) ──
  const providerCache = new Map<DeliveryChannel, EmailSendProvider>();

  async function getProvider(channel: DeliveryChannel): Promise<EmailSendProvider> {
    const cached = providerCache.get(channel);
    if (cached) return cached;

    const config = await resolveDeliveryConfig(supabase, orgId, channel);
    // Gmail and Outreach providers need supabase + org context
    const enrichedConfig = {
      ...config,
      supabase,
      org_id: orgId,
      user_id: userId,
    };
    const provider = await createSendProvider(channel, enrichedConfig);
    providerCache.set(channel, provider);
    return provider;
  }

  // Load template if needed
  let templateHtml: string | null = null;
  if (camp.template_id) {
    const { data: template } = await supabase
      .from("email_brand_assets")
      .select("content_html")
      .eq("id", camp.template_id)
      .eq("org_id", orgId)
      .single();
    templateHtml = (template?.content_html as string) || null;
  }

  // Update campaign status
  await supabase
    .from("email_campaigns")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", campaignId);

  let sentCount = 0;
  let failedCount = 0;
  let taskCount = 0;

  // ── Step 5: Send/route each variant ──
  for (let i = 0; i < typedVariants.length; i += SEND_CONCURRENCY) {
    const batch = typedVariants.slice(i, i + SEND_CONCURRENCY);

    await Promise.allSettled(
      batch.map(async (variant) => {
        try {
          // Determine per-step channel and step type
          const stepKey = variant.strategy_group_id
            ? `${variant.strategy_group_id}_${variant.step_number || 1}`
            : "";
          const stepChannel = stepChannelMap.get(stepKey) || camp.delivery_channel;
          const stepType = stepTypeMap.get(stepKey) || "auto_email";

          // Non-email step types → create a task instead of sending
          if (
            stepType !== "auto_email" &&
            stepType !== "manual_email"
          ) {
            await createSingleTask(
              supabase, orgId, userId, campaignId, camp.name, variant, stepType,
            );
            taskCount++;
            return;
          }

          // Get the content — use edited version if available
          const content = variant.status === "edited" && variant.edited_content
            ? variant.edited_content as { subject_line?: string; body_html?: string; body_text?: string; preview_text?: string }
            : variant;

          // Wrap in template if applicable
          let htmlBody = content.body_html || "";
          if (templateHtml) {
            htmlBody = wrapContentInTemplate(htmlBody, templateHtml);
          }

          // Get provider for this step's channel
          const provider = await getProvider(stepChannel);

          // Send through provider
          const result = await provider.sendOne({
            to: variant.customer_email,
            subject: content.subject_line || camp.name,
            htmlBody,
            textBody: content.body_text || "",
            from: camp.delivery_config?.from_name
              ? {
                  name: camp.delivery_config.from_name as string,
                  email: (camp.delivery_config.from_email as string) || "",
                }
              : undefined,
            replyTo: (camp.delivery_config?.reply_to as string) || undefined,
            metadata: {
              campaign_id: campaignId,
              variant_id: variant.id,
              customer_name: variant.customer_name,
            },
          });

          // Update variant
          await supabase
            .from("email_customer_variants")
            .update({
              status: "sent",
              delivery_id: result.messageId,
              delivery_status: "sent",
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", variant.id);

          sentCount++;

          // Fire-and-forget: log to CRM activities + graph
          logCampaignSend(supabase, orgId, userId, variant, {
            campaignId,
            campaignName: camp.name,
            channel: stepChannel,
            stepNumber: variant.step_number,
          }).catch(() => {}); // Swallow — non-fatal
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Send failed";
          await supabase
            .from("email_customer_variants")
            .update({
              status: "failed",
              delivery_status: "failed",
              delivery_metrics: {
                error: errorMsg,
                failure_type: "provider_error",
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", variant.id);

          failedCount++;
        }
      })
    );

    // Small delay between batches to respect rate limits
    if (i + SEND_CONCURRENCY < typedVariants.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Update campaign final status
  const totalAttempted = sentCount + failedCount + taskCount;
  const finalStatus = totalAttempted === 0
    ? "failed"
    : failedCount === totalAttempted
      ? "failed"
      : "sent";

  await supabase
    .from("email_campaigns")
    .update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount + validation.invalid.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return {
    campaignId,
    sent: sentCount,
    failed: failedCount + validation.invalid.length,
    status: finalStatus,
  };
}

/* ── Task Generation ──────────────────────────────────── */

/**
 * Build a human-readable task title from step type and customer info.
 */
function buildTaskTitle(
  stepType: StepType,
  customerName: string,
  stepNumber: number,
): string {
  const actionLabels: Record<StepType, string> = {
    auto_email: "Send email to",
    manual_email: "Review & send email to",
    phone_call: "Call",
    linkedin_view: "View LinkedIn profile of",
    linkedin_connect: "Send LinkedIn connect to",
    linkedin_message: "Send LinkedIn message to",
    custom_task: "Complete task for",
  };

  const action = actionLabels[stepType] || "Complete task for";
  return `${action} ${customerName} (Step ${stepNumber})`;
}

/**
 * Create a single campaign task row for a variant (manual steps / non-email).
 */
async function createSingleTask(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  campaignId: string,
  campaignName: string,
  variant: EmailCustomerVariant,
  stepType: StepType,
): Promise<void> {
  const title = buildTaskTitle(
    stepType,
    variant.customer_name || variant.customer_email,
    variant.step_number || 1,
  );

  await supabase.from("campaign_tasks").insert({
    org_id: orgId,
    campaign_id: campaignId,
    variant_id: variant.id,
    strategy_group_id: variant.strategy_group_id || null,
    step_number: variant.step_number || 1,
    step_type: stepType,
    ecom_customer_id: variant.ecom_customer_id,
    customer_email: variant.customer_email,
    customer_name: variant.customer_name,
    assigned_to: userId,
    title,
    instructions: null,
    status: "pending",
  });
}

/**
 * Create tasks for ALL variants (manual execution mode).
 * Instead of sending, the campaign creates one task per variant
 * for the rep to review and execute manually.
 */
async function createTasksForVariants(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  campaignId: string,
  camp: EmailCampaign,
  variants: EmailCustomerVariant[],
): Promise<SendCampaignResult> {
  // Load step types from strategy groups
  const stepTypeMap = new Map<string, StepType>();
  if (camp.has_strategy) {
    const { data: groups } = await supabase
      .from("campaign_strategy_groups")
      .select("id, sequence_steps")
      .eq("campaign_id", campaignId);

    for (const group of (groups || []) as unknown as CampaignStrategyGroup[]) {
      for (const step of (group.sequence_steps || [])) {
        stepTypeMap.set(`${group.id}_${step.step_number}`, step.step_type || "manual_email");
      }
    }
  }

  // Create tasks in batches
  let taskCount = 0;
  for (let i = 0; i < variants.length; i += 50) {
    const batch = variants.slice(i, i + 50);
    const rows = batch.map((variant) => {
      const stepKey = variant.strategy_group_id
        ? `${variant.strategy_group_id}_${variant.step_number || 1}`
        : "";
      const stepType = stepTypeMap.get(stepKey) || "manual_email";
      const title = buildTaskTitle(
        stepType,
        variant.customer_name || variant.customer_email,
        variant.step_number || 1,
      );

      return {
        org_id: orgId,
        campaign_id: campaignId,
        variant_id: variant.id,
        strategy_group_id: variant.strategy_group_id || null,
        step_number: variant.step_number || 1,
        step_type: stepType,
        ecom_customer_id: variant.ecom_customer_id,
        customer_email: variant.customer_email,
        customer_name: variant.customer_name,
        assigned_to: userId,
        title,
        status: "pending",
      };
    });

    await supabase.from("campaign_tasks").insert(rows);
    taskCount += rows.length;
  }

  // Update campaign status
  await supabase
    .from("email_campaigns")
    .update({
      status: "review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return {
    campaignId,
    sent: 0,
    failed: 0,
    status: `manual_tasks_created:${taskCount}`,
  };
}

/**
 * Get campaign status with variant counts and delivery metrics.
 */
export async function getCampaignStatus(
  supabase: SupabaseClient,
  orgId: string,
  campaignId: string
): Promise<CampaignStatusResult> {
  // Load campaign
  const { data: campaign, error: campErr } = await supabase
    .from("email_campaigns")
    .select("*, segments(name)")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (campErr || !campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const camp = campaign as unknown as EmailCampaign & { segments: { name: string } | null };

  // Load variant counts by status
  const { data: variants } = await supabase
    .from("email_customer_variants")
    .select("status, delivery_status")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId);

  const statusCounts: Record<string, number> = {
    draft: 0, approved: 0, edited: 0, rejected: 0, sending: 0, sent: 0, failed: 0,
  };
  const deliveryMetrics = { delivered: 0, opened: 0, clicked: 0, bounced: 0 };

  for (const v of (variants ?? []) as Array<{ status: string; delivery_status: string }>) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
    if (v.delivery_status === "delivered") deliveryMetrics.delivered++;
    if (v.delivery_status === "opened") deliveryMetrics.opened++;
    if (v.delivery_status === "clicked") deliveryMetrics.clicked++;
    if (v.delivery_status === "bounced") deliveryMetrics.bounced++;
  }

  return {
    id: camp.id,
    name: camp.name,
    campaignType: camp.campaign_type,
    status: camp.status,
    emailType: camp.email_type,
    deliveryChannel: camp.delivery_channel,
    segmentName: camp.segments?.name ?? null,
    total: camp.total_variants,
    ...statusCounts,
    deliveryMetrics,
  } as CampaignStatusResult;
}

/**
 * Plan a campaign strategy — analyze customers and create sub-groups
 * with tailored sequences. Works with a segment or the full customer list.
 */
export async function planCampaignStrategy(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    name: string;
    segmentId?: string;
    customerIds?: string[];
    strategyPrompt: string;
    emailType?: CampaignEmailType;
    deliveryChannel?: DeliveryChannel;
  },
  userId: string
): Promise<{
  campaignId: string;
  groups: Array<{ name: string; customerCount: number; steps: number; reasoning: string }>;
}> {
  const anthropic = new Anthropic();

  let segmentName = "All Customers";
  let customers: CustomerContext[];

  if (input.customerIds && input.customerIds.length > 0) {
    // Explicit customer IDs — create an auto-segment so existing segment path handles it
    const { data: autoSegment } = await supabase
      .from("segments")
      .insert({
        org_id: orgId,
        name: `Auto: ${input.name}`,
        description: `Auto-created for strategic campaign targeting ${input.customerIds.length} customers`,
        segment_type: "manual",
        rules: { type: "rule", field: "id", operator: "in", value: "direct" },
        customer_count: input.customerIds.length,
        status: "active",
      })
      .select("id")
      .single();

    if (autoSegment) {
      const memberRows = input.customerIds.map((custId) => ({
        org_id: orgId,
        segment_id: autoSegment.id as string,
        ecom_customer_id: custId,
      }));
      for (let i = 0; i < memberRows.length; i += 500) {
        await supabase.from("segment_members").insert(memberRows.slice(i, i + 500));
      }
      input.segmentId = autoSegment.id as string;
    }
    segmentName = `${input.customerIds.length} targeted customers`;
    customers = await loadSegmentCustomerContexts(supabase, orgId, input.segmentId!);
  } else if (input.segmentId) {
    // 1a. Load segment
    const { data: segment, error: segErr } = await supabase
      .from("segments")
      .select("id, name, customer_count")
      .eq("id", input.segmentId)
      .eq("org_id", orgId)
      .single();

    if (segErr || !segment) {
      throw new Error("Segment not found");
    }
    segmentName = segment.name as string;

    // 2a. Load segment customer contexts
    customers = await loadSegmentCustomerContexts(supabase, orgId, input.segmentId);
  } else {
    // 1b/2b. Load all customers
    customers = await loadAllCustomerContexts(supabase, orgId);
  }

  if (customers.length === 0) {
    throw new Error("No customers found to build strategy for");
  }

  // 3. Resolve delivery config
  let deliveryConfig: Record<string, unknown> = {};
  const deliveryChannel = input.deliveryChannel || "klaviyo";
  if (deliveryChannel === "klaviyo") {
    try {
      const kConfig = await loadKlaviyoConfig(supabase, orgId);
      if (kConfig) {
        deliveryConfig = { api_key: kConfig.api_key };
      }
    } catch { /* non-fatal */ }
  }

  // 4. Create campaign record
  const { data: campaign, error: campErr } = await supabase
    .from("email_campaigns")
    .insert({
      org_id: orgId,
      name: input.name,
      campaign_type: "per_customer" as CampaignType,
      segment_id: input.segmentId ?? null,  // may be auto-created from customerIds
      status: "draft",
      email_type: input.emailType || "custom",
      prompt_used: input.strategyPrompt,
      delivery_channel: deliveryChannel,
      delivery_config: deliveryConfig,
      has_strategy: true,
      total_variants: 0,
      approved_count: 0,
      sent_count: 0,
      failed_count: 0,
      stats: {},
      created_by: userId,
    })
    .select("id")
    .single();

  if (campErr || !campaign) {
    throw new Error("Failed to create campaign");
  }

  const campaignId = campaign.id as string;

  // 5. Build a summary of the segment for Claude to analyze
  const lifecycleDist: Record<string, number> = {};
  const commStyleDist: Record<string, number> = {};
  let totalSpent = 0;
  let totalOrders = 0;

  for (const c of customers) {
    if (c.lifecycleStage) lifecycleDist[c.lifecycleStage] = (lifecycleDist[c.lifecycleStage] ?? 0) + 1;
    if (c.commStyle) commStyleDist[c.commStyle] = (commStyleDist[c.commStyle] ?? 0) + 1;
    totalSpent += c.totalSpent;
    totalOrders += c.ordersCount;
  }

  // Sample 20 customers for Claude to see individual profiles
  const sampleCustomers = customers
    .sort(() => Math.random() - 0.5)
    .slice(0, 20)
    .map((c) => ({
      name: c.name,
      email: c.email,
      orders: c.ordersCount,
      totalSpent: c.totalSpent,
      lastOrder: c.lastOrderAt,
      lifecycle: c.lifecycleStage,
      commStyle: c.commStyle,
      topProducts: c.products.slice(0, 3).map((p) => p.title),
      rfm: c.rfm,
    }));

  // Parse requested email count from strategy prompt (e.g., "3 emails", "a 5-email sequence")
  const emailCountMatch = input.strategyPrompt.match(/(\d+)\s*(?:-?\s*)?email/i);
  const requestedEmailCount = emailCountMatch ? parseInt(emailCountMatch[1], 10) : null;
  const effectiveEmailCount = requestedEmailCount && requestedEmailCount >= 2 && requestedEmailCount <= 10
    ? requestedEmailCount
    : 3; // default to 3-step sequences

  // Build dynamic example steps matching the requested count
  const exampleStepTypes = ["nurture", "promotional", "follow_up", "win_back", "announcement"];
  const exampleDelays = [0, 3, 7, 14, 21, 28, 35];
  const exampleSteps = Array.from({ length: effectiveEmailCount }, (_, i) => ({
    step_number: i + 1,
    delay_days: exampleDelays[i] ?? (i * 5),
    email_type: exampleStepTypes[i % exampleStepTypes.length],
    prompt: `Write email ${i + 1} of ${effectiveEmailCount}...`,
    subject_hint: `Step ${i + 1} subject line`,
  }));

  const strategyPrompt = `You are an expert email marketing strategist. Analyze this customer base and create a strategic campaign plan with distinct sub-groups.

## Audience: "${segmentName}" (${customers.length} customers)

### Aggregate Profile:
- Total customers: ${customers.length}
- Average spend: $${(totalSpent / customers.length).toFixed(0)}
- Average orders: ${(totalOrders / customers.length).toFixed(1)}
- Lifecycle distribution: ${JSON.stringify(lifecycleDist)}
- Communication style distribution: ${JSON.stringify(commStyleDist)}

### Sample Customer Profiles (20 of ${customers.length}):
${JSON.stringify(sampleCustomers, null, 2)}

### User's Strategy Direction:
${input.strategyPrompt}

## CRITICAL REQUIREMENT — Email Count:
Each group MUST have exactly **${effectiveEmailCount} sequence_steps**. ${requestedEmailCount ? `The user specifically requested ${requestedEmailCount} emails.` : `Default to ${effectiveEmailCount} emails per group.`} Do NOT create fewer steps. Every group must have ${effectiveEmailCount} steps with different delay_days, email_type, and prompt.

## Instructions:
Create 2-6 distinct sub-groups within this segment. For each group:
1. Define WHO is in the group (criteria based on available customer data: lifecycle stage, comm style, order count, spend level, product preferences, rfm scores)
2. Explain WHY this group needs different treatment
3. Design exactly ${effectiveEmailCount} emails with specific timing and purpose for each step

Respond in this exact JSON format:
\`\`\`json
{
  "groups": [
    {
      "group_name": "High-Value Champions",
      "group_description": "Customers who have spent over $500 with 5+ orders",
      "ai_reasoning": "These customers are already loyal. The goal is to increase AOV with premium upsells and exclusive offers.",
      "filter_criteria": {
        "min_total_spent": 500,
        "min_orders": 5,
        "lifecycle_stages": ["champion", "loyal"]
      },
      "sequence_steps": ${JSON.stringify(exampleSteps, null, 8)}
    }
  ]
}
\`\`\`

IMPORTANT: The filter_criteria should use fields available in the customer data: lifecycle_stages (array), comm_styles (array), min_orders, max_orders, min_total_spent, max_total_spent, min_rfm_recency, max_rfm_recency, product_affinities (array of product name keywords).

Make the groups mutually exclusive when possible. Every customer should fit into exactly one group — include an "Other / General" group if needed to catch remaining customers.

REMINDER: Each group MUST have exactly ${effectiveEmailCount} sequence_steps. Do not return fewer.`;

  // 6. Call Claude to generate the strategy
  const response = await withRateLimitRetry(
    () => anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: strategyPrompt }],
    }),
    "strategy planning"
  );

  // 7. Parse the response
  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*"groups"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse strategy response from AI");
  }

  const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]) as {
    groups: Array<{
      group_name: string;
      group_description: string;
      ai_reasoning: string;
      filter_criteria: Record<string, unknown>;
      sequence_steps: StrategySequenceStep[];
    }>;
  };

  // 7b. Enforce minimum step count — pad groups that have fewer steps than requested
  for (const g of parsed.groups) {
    const steps = g.sequence_steps || [];
    if (steps.length < effectiveEmailCount) {
      console.warn(`[campaign-engine] Group "${g.group_name}" has ${steps.length} steps, padding to ${effectiveEmailCount}`);
      const lastDelay = steps.length > 0 ? (steps[steps.length - 1].delay_days ?? 0) : 0;
      while (steps.length < effectiveEmailCount) {
        const stepNum = steps.length + 1;
        steps.push({
          step_number: stepNum,
          delay_days: lastDelay + (stepNum * 3),
          email_type: (["follow_up", "nurture", "promotional"] as const)[stepNum % 3],
          prompt: `Write follow-up email ${stepNum} for ${g.group_name}. Build on the previous emails in the sequence.`,
          subject_hint: `Follow-up ${stepNum}`,
        });
      }
      g.sequence_steps = steps;
    }
  }

  // 8. Assign customers to groups based on filter criteria
  const groupResults: Array<{ name: string; customerCount: number; steps: number; reasoning: string }> = [];

  const assignedCustomerIds = new Set<string>();

  for (let i = 0; i < parsed.groups.length; i++) {
    const g = parsed.groups[i];
    const criteria = g.filter_criteria;

    const matchingCustomers = customers.filter((c) => {
      if (assignedCustomerIds.has(c.customerId)) return false; // Already assigned

      // Filter by lifecycle stages
      if (criteria.lifecycle_stages && Array.isArray(criteria.lifecycle_stages)) {
        if (!c.lifecycleStage || !(criteria.lifecycle_stages as string[]).includes(c.lifecycleStage)) return false;
      }
      // Filter by comm styles
      if (criteria.comm_styles && Array.isArray(criteria.comm_styles)) {
        if (!c.commStyle || !(criteria.comm_styles as string[]).includes(c.commStyle)) return false;
      }
      // Filter by order count
      if (criteria.min_orders && c.ordersCount < (criteria.min_orders as number)) return false;
      if (criteria.max_orders && c.ordersCount > (criteria.max_orders as number)) return false;
      // Filter by spend
      if (criteria.min_total_spent && c.totalSpent < (criteria.min_total_spent as number)) return false;
      if (criteria.max_total_spent && c.totalSpent > (criteria.max_total_spent as number)) return false;
      // Filter by RFM
      if (criteria.min_rfm_recency && (c.rfm?.recency ?? 0) < (criteria.min_rfm_recency as number)) return false;
      if (criteria.max_rfm_recency && (c.rfm?.recency ?? 5) > (criteria.max_rfm_recency as number)) return false;
      // Filter by product affinities
      if (criteria.product_affinities && Array.isArray(criteria.product_affinities)) {
        const customerProducts = c.products.map((p) => p.title.toLowerCase()).join(" ");
        const hasAffinity = (criteria.product_affinities as string[]).some((a) =>
          customerProducts.includes(a.toLowerCase())
        );
        if (!hasAffinity) return false;
      }

      return true;
    });

    // Mark as assigned
    const customerIds = matchingCustomers.map((c) => c.customerId);
    for (const id of customerIds) assignedCustomerIds.add(id);

    const steps = g.sequence_steps || [];

    // Save strategy group
    await supabase.from("campaign_strategy_groups").insert({
      org_id: orgId,
      campaign_id: campaignId,
      group_name: g.group_name,
      group_description: g.group_description,
      ai_reasoning: g.ai_reasoning,
      filter_criteria: criteria,
      customer_ids: customerIds,
      customer_count: customerIds.length,
      sequence_steps: steps,
      total_emails: customerIds.length * steps.length,
      sort_order: i,
      status: "draft",
    });

    groupResults.push({
      name: g.group_name,
      customerCount: customerIds.length,
      steps: steps.length,
      reasoning: g.ai_reasoning,
    });
  }

  // 9. Assign remaining unmatched customers to a catchall group if any
  const unmatched = customers.filter((c) => !assignedCustomerIds.has(c.customerId));
  if (unmatched.length > 0) {
    const unmatchedIds = unmatched.map((c) => c.customerId);
    // Catchall group gets same number of steps as other groups
    const defaultSteps: StrategySequenceStep[] = Array.from({ length: effectiveEmailCount }, (_, idx) => ({
      step_number: idx + 1,
      delay_days: idx * 3,
      email_type: input.emailType || "custom",
      prompt: idx === 0
        ? input.strategyPrompt
        : `Write follow-up email ${idx + 1} of ${effectiveEmailCount}. Build on the previous emails.`,
      subject_hint: undefined,
    }));

    await supabase.from("campaign_strategy_groups").insert({
      org_id: orgId,
      campaign_id: campaignId,
      group_name: "General",
      group_description: "Customers not matching other group criteria",
      ai_reasoning: "Catchall group for remaining segment members who did not fit specific sub-group filters.",
      filter_criteria: {},
      customer_ids: unmatchedIds,
      customer_count: unmatchedIds.length,
      sequence_steps: defaultSteps,
      total_emails: unmatchedIds.length * effectiveEmailCount,
      sort_order: parsed.groups.length,
      status: "draft",
    });

    groupResults.push({
      name: "General",
      customerCount: unmatchedIds.length,
      steps: 1,
      reasoning: "Catchall group for remaining segment members.",
    });
  }

  // 10. Update campaign status
  await supabase
    .from("email_campaigns")
    .update({
      status: "draft",
      has_strategy: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return { campaignId, groups: groupResults };
}

/**
 * Get a summary of all campaigns for the system prompt.
 */
export async function getCampaignSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  totalCampaigns: number;
  byStatus: Record<string, number>;
  recentCampaigns: Array<{ name: string; status: string; type: string; variants: number }>;
}> {
  const empty = { totalCampaigns: 0, byStatus: {}, recentCampaigns: [] };

  try {
    const { data, error } = await supabase
      .from("email_campaigns")
      .select("name, status, campaign_type, total_variants")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error || !data) return empty;

    const byStatus: Record<string, number> = {};
    const recentCampaigns = (data as Array<{ name: string; status: string; campaign_type: string; total_variants: number }>).map((c) => {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      return {
        name: c.name,
        status: c.status,
        type: c.campaign_type,
        variants: c.total_variants,
      };
    });

    return { totalCampaigns: data.length, byStatus, recentCampaigns };
  } catch {
    return empty;
  }
}

/* ── Internal: Load Customer Contexts ──────────────────── */

async function loadSegmentCustomerContexts(
  supabase: SupabaseClient,
  orgId: string,
  segmentId: string
): Promise<CustomerContext[]> {
  // 1. Load all segment members (paginated)
  const PAGE = 1000;
  const allMembers: Array<{ ecom_customer_id: string }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("segment_members")
      .select("ecom_customer_id")
      .eq("segment_id", segmentId)
      .eq("org_id", orgId)
      .range(offset, offset + PAGE - 1);

    if (error) break;
    if (data) allMembers.push(...(data as Array<{ ecom_customer_id: string }>));
    hasMore = (data?.length ?? 0) === PAGE;
    offset += PAGE;
  }

  if (allMembers.length === 0) return [];

  const customerIds = allMembers.map((m) => m.ecom_customer_id);

  // 2. Load customer records (batched)
  const customers = await batchQuery<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    orders_count: number;
    total_spent: number;
    last_order_at: string | null;
  }>(supabase, "ecom_customers", customerIds, "id, email, first_name, last_name, orders_count, total_spent, last_order_at", orgId);

  // 3. Load behavioral profiles (batched)
  const profiles = await batchQuery<{
    ecom_customer_id: string;
    lifecycle_stage: string | null;
    inferred_comm_style: string | null;
    interval_trend: string | null;
    predicted_next_purchase: string | null;
    days_until_predicted: number | null;
    recency_score: number | null;
    frequency_score: number | null;
    monetary_score: number | null;
    top_product_type: string | null;
    top_product_title: string | null;
    product_affinities: Array<{ product_title: string; order_count: number }>;
  }>(supabase, "customer_behavioral_profiles", customerIds, "*", orgId, "ecom_customer_id");

  const profileMap = new Map(profiles.map((p) => [p.ecom_customer_id, p]));

  // 4. Load orders with line items for product context (batched)
  const orders = await batchQuery<{
    ecom_customer_id: string;
    line_items: Array<{ title: string; quantity: number; price: number }>;
  }>(supabase, "ecom_orders", customerIds, "ecom_customer_id, line_items", orgId, "ecom_customer_id");

  // Group products by customer
  const customerProducts = new Map<string, Array<{ title: string; quantity: number; price: number }>>();
  for (const order of orders) {
    const existing = customerProducts.get(order.ecom_customer_id) || [];
    if (order.line_items && Array.isArray(order.line_items)) {
      for (const item of order.line_items) {
        existing.push({
          title: item.title || "Unknown",
          quantity: item.quantity || 1,
          price: item.price || 0,
        });
      }
    }
    customerProducts.set(order.ecom_customer_id, existing);
  }

  // 5. Build contexts — only include customers with email
  const contexts: CustomerContext[] = [];

  for (const customer of customers) {
    if (!customer.email) continue;

    const profile = profileMap.get(customer.id);
    const products = customerProducts.get(customer.id) || [];

    contexts.push({
      customerId: customer.id,
      email: customer.email,
      name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.email.split("@")[0],
      ordersCount: customer.orders_count || 0,
      totalSpent: customer.total_spent || 0,
      lastOrderAt: customer.last_order_at,
      products,
      lifecycleStage: profile?.lifecycle_stage ?? null,
      commStyle: profile?.inferred_comm_style ?? null,
      intervalTrend: profile?.interval_trend ?? null,
      predictedNextPurchase: profile?.predicted_next_purchase ?? null,
      daysUntilPredicted: profile?.days_until_predicted ?? null,
      rfm: {
        recency: profile?.recency_score ?? null,
        frequency: profile?.frequency_score ?? null,
        monetary: profile?.monetary_score ?? null,
      },
      topProductType: profile?.top_product_type ?? null,
      topProductTitle: profile?.top_product_title ?? null,
      productAffinities: (profile?.product_affinities || []).slice(0, 5).map((a) => ({
        title: a.product_title,
        count: a.order_count,
      })),
    });
  }

  return contexts;
}

/**
 * Load ALL customer contexts from the org's ecom_customers table.
 * Used when a campaign is created without a segment (targets the full customer list).
 */
async function loadAllCustomerContexts(
  supabase: SupabaseClient,
  orgId: string
): Promise<CustomerContext[]> {
  // 1. Load all customer IDs (paginated)
  const PAGE = 1000;
  const allCustomerIds: string[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("ecom_customers")
      .select("id")
      .eq("org_id", orgId)
      .range(offset, offset + PAGE - 1);

    if (error) break;
    if (data) allCustomerIds.push(...data.map((d) => d.id as string));
    hasMore = (data?.length ?? 0) === PAGE;
    offset += PAGE;
  }

  if (allCustomerIds.length === 0) return [];

  // Reuse the same enrichment logic as loadSegmentCustomerContexts
  const customers = await batchQuery<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    orders_count: number;
    total_spent: number;
    last_order_at: string | null;
  }>(supabase, "ecom_customers", allCustomerIds, "id, email, first_name, last_name, orders_count, total_spent, last_order_at", orgId);

  const profiles = await batchQuery<{
    ecom_customer_id: string;
    lifecycle_stage: string | null;
    inferred_comm_style: string | null;
    interval_trend: string | null;
    predicted_next_purchase: string | null;
    days_until_predicted: number | null;
    recency_score: number | null;
    frequency_score: number | null;
    monetary_score: number | null;
    top_product_type: string | null;
    top_product_title: string | null;
    product_affinities: Array<{ product_title: string; order_count: number }>;
  }>(supabase, "customer_behavioral_profiles", allCustomerIds, "*", orgId, "ecom_customer_id");

  const profileMap = new Map(profiles.map((p) => [p.ecom_customer_id, p]));

  const orders = await batchQuery<{
    ecom_customer_id: string;
    line_items: Array<{ title: string; quantity: number; price: number }>;
  }>(supabase, "ecom_orders", allCustomerIds, "ecom_customer_id, line_items", orgId, "ecom_customer_id");

  const customerProducts = new Map<string, Array<{ title: string; quantity: number; price: number }>>();
  for (const order of orders) {
    const existing = customerProducts.get(order.ecom_customer_id) || [];
    if (order.line_items && Array.isArray(order.line_items)) {
      for (const item of order.line_items) {
        existing.push({
          title: item.title || "Unknown",
          quantity: item.quantity || 1,
          price: item.price || 0,
        });
      }
    }
    customerProducts.set(order.ecom_customer_id, existing);
  }

  const contexts: CustomerContext[] = [];

  for (const customer of customers) {
    if (!customer.email) continue;

    const profile = profileMap.get(customer.id);
    const products = customerProducts.get(customer.id) || [];

    contexts.push({
      customerId: customer.id,
      email: customer.email,
      name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.email.split("@")[0],
      ordersCount: customer.orders_count || 0,
      totalSpent: customer.total_spent || 0,
      lastOrderAt: customer.last_order_at,
      products,
      lifecycleStage: profile?.lifecycle_stage ?? null,
      commStyle: profile?.inferred_comm_style ?? null,
      intervalTrend: profile?.interval_trend ?? null,
      predictedNextPurchase: profile?.predicted_next_purchase ?? null,
      daysUntilPredicted: profile?.days_until_predicted ?? null,
      rfm: {
        recency: profile?.recency_score ?? null,
        frequency: profile?.frequency_score ?? null,
        monetary: profile?.monetary_score ?? null,
      },
      topProductType: profile?.top_product_type ?? null,
      topProductTitle: profile?.top_product_title ?? null,
      productAffinities: (profile?.product_affinities || []).slice(0, 5).map((a) => ({
        title: a.product_title,
        count: a.order_count,
      })),
    });
  }

  return contexts;
}

/* ── Internal: Batched Email Generation ────────────────── */

interface ParsedEmail {
  subject_line: string;
  preview_text: string;
  body_html: string;
  body_text: string;
}

/**
 * Generate emails for a batch of customers in a single Claude call.
 */
async function generateBatchedEmails(
  anthropic: Anthropic,
  campaign: EmailCampaign,
  org: Record<string, unknown> | null,
  brandAssets: EmailBrandAsset[],
  customers: CustomerContext[]
): Promise<ParsedEmail[]> {
  const systemPrompt = buildCampaignGenerationPrompt(campaign, org, brandAssets, customers.length);

  // Build customer context blocks
  const customerBlocks = customers.map((c, i) => {
    const productSummary = summarizeProducts(c.products);
    const daysSinceOrder = c.lastOrderAt
      ? Math.round((Date.now() - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let block = `=== CUSTOMER ${i + 1}: ${c.name} (${c.email}) ===\n`;
    block += `Orders: ${c.ordersCount} total ($${c.totalSpent.toFixed(2)} LTV)\n`;

    if (productSummary) block += `Products: ${productSummary}\n`;
    if (daysSinceOrder !== null) {
      block += `Last order: ${daysSinceOrder} days ago`;
      if (c.daysUntilPredicted !== null) {
        block += ` (predicted next: ${c.daysUntilPredicted > 0 ? `in ${c.daysUntilPredicted} days` : `${Math.abs(c.daysUntilPredicted)} days overdue`})`;
      }
      block += "\n";
    }
    if (c.lifecycleStage) block += `Lifecycle: ${c.lifecycleStage}`;
    if (c.commStyle) block += ` | Communication: ${c.commStyle}`;
    if (c.intervalTrend) block += ` | Interval trend: ${c.intervalTrend}`;
    if (c.lifecycleStage || c.commStyle || c.intervalTrend) block += "\n";
    if (c.rfm.recency !== null) {
      block += `RFM: R=${c.rfm.recency} F=${c.rfm.frequency} M=${c.rfm.monetary}\n`;
    }

    return block;
  });

  const userPrompt = `Generate a unique ${EMAIL_TYPE_LABELS[campaign.email_type]} email for EACH customer below.

Campaign goal: ${campaign.prompt_used}

${customerBlocks.join("\n")}`;

  const response = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // Parse multi-customer response
  return parseMultiCustomerResponse(responseText, customers.length);
}

/**
 * Generate a single broadcast email (same content for all).
 */
async function generateBroadcastEmail(
  anthropic: Anthropic,
  campaign: EmailCampaign,
  org: Record<string, unknown> | null,
  brandAssets: EmailBrandAsset[],
  customers: CustomerContext[]
): Promise<ParsedEmail> {
  // Build aggregate context
  const avgSpent = customers.reduce((s, c) => s + c.totalSpent, 0) / customers.length;
  const avgOrders = customers.reduce((s, c) => s + c.ordersCount, 0) / customers.length;
  const stages: Record<string, number> = {};
  for (const c of customers) {
    const s = c.lifecycleStage || "unknown";
    stages[s] = (stages[s] ?? 0) + 1;
  }

  const systemPrompt = buildCampaignGenerationPrompt(campaign, org, brandAssets, 1);

  const userPrompt = `Generate a single ${EMAIL_TYPE_LABELS[campaign.email_type]} email for this audience.

Campaign goal: ${campaign.prompt_used}

Audience Summary:
- ${customers.length} customers
- Average LTV: $${avgSpent.toFixed(2)}
- Average orders: ${avgOrders.toFixed(1)}
- Lifecycle stages: ${JSON.stringify(stages)}

Use {{first_name}} for personalization.`;

  const response = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseSingleEmail(responseText);
}

/* ── Internal: Prompt Building ─────────────────────────── */

const EMAIL_TYPE_LABELS: Record<CampaignEmailType, string> = {
  promotional: "Promotional",
  win_back: "Win-Back",
  nurture: "Nurture",
  announcement: "Announcement",
  welcome: "Welcome",
  follow_up: "Follow-Up",
  custom: "Custom",
};

function buildCampaignGenerationPrompt(
  campaign: EmailCampaign,
  org: Record<string, unknown> | null,
  brandAssets: EmailBrandAsset[],
  customerCount: number
): string {
  let prompt = `You are an expert email marketing copywriter generating ${EMAIL_TYPE_LABELS[campaign.email_type]} emails.

## Output Format
For EACH customer, structure your response exactly like this:

=== EMAIL ${customerCount > 1 ? "N" : "1"} ===
SUBJECT: [subject line here]
PREVIEW: [preview text / preheader, 40-90 chars]
---BODY_HTML---
[email HTML body with inline styles, email-safe]
---BODY_TEXT---
[plain text version]
=== END ===

${customerCount > 1 ? `Generate ${customerCount} separate emails, one for each customer. Reference their specific products, purchase history, and lifecycle stage. Each email should feel personally written for that individual.` : "Generate a single email with {{first_name}} personalization tokens."}

## Rules
- Write compelling, conversion-focused copy
- Subject lines under 60 characters
- Preview text should complement (not repeat) the subject line
- HTML must be email-safe (inline styles, no external CSS)
- Include a clear CTA (call to action)
- Reference SPECIFIC products the customer has purchased
- Adapt tone to match each customer's communication style
- For at-risk/lapsed customers: create urgency without being pushy
`;

  // Add org context
  if (org) {
    prompt += `\n## Brand Context\n`;
    if (org.name) prompt += `**Company:** ${org.name}\n`;
    if (org.description) prompt += `**What they sell:** ${org.description}\n`;
    if (org.industry) prompt += `**Industry:** ${org.industry}\n`;
    if (org.target_market) prompt += `**Target Market:** ${org.target_market}\n`;
  }

  // Add brand assets
  if (brandAssets.length > 0) {
    prompt += `\n## Brand Assets & Style Reference\nMatch the tone, voice, and visual style of these assets:\n\n`;

    for (const asset of brandAssets) {
      prompt += `### ${asset.name} (${asset.asset_type})\n`;

      if (asset.metadata && Object.keys(asset.metadata).length > 0) {
        const meta = asset.metadata;
        if (meta.tone) prompt += `**Tone:** ${meta.tone}\n`;
        if (meta.notes) prompt += `**Notes:** ${meta.notes}\n`;
      }

      if (asset.content_text) {
        const truncated = asset.content_text.length > 2000
          ? asset.content_text.slice(0, 2000) + "\n...(truncated)"
          : asset.content_text;
        prompt += `\`\`\`\n${truncated}\n\`\`\`\n`;
      }

      if (asset.content_html && asset.asset_type === "html_template") {
        const truncated = asset.content_html.length > 3000
          ? asset.content_html.slice(0, 3000) + "\n...(truncated)"
          : asset.content_html;
        prompt += `**HTML Template (use as visual structure):**\n\`\`\`html\n${truncated}\n\`\`\`\n`;
      }
    }
  }

  return prompt;
}

/* ── Internal: Response Parsing ────────────────────────── */

function parseMultiCustomerResponse(text: string, expectedCount: number): ParsedEmail[] {
  // Discard any preamble text before the first === EMAIL N === marker.
  // Claude often starts with intro text before the markers, which causes
  // .split() to produce a non-email first element (off-by-one bug).
  const firstMarker = text.search(/===\s*EMAIL\s*\d+\s*===/i);
  const cleanedText = firstMarker >= 0 ? text.slice(firstMarker) : text;

  // Split by === EMAIL N === markers
  let emailBlocks = cleanedText.split(/===\s*EMAIL\s*\d+\s*===/i).filter((b) => b.trim());

  // If no markers found, try alternative patterns
  if (emailBlocks.length <= 1) {
    // Try alternative: split by === CUSTOMER N ===
    const firstCustMarker = text.search(/===\s*CUSTOMER\s*\d+\s*===/i);
    const cleanedCustText = firstCustMarker >= 0 ? text.slice(firstCustMarker) : text;
    const altBlocks = cleanedCustText.split(/===\s*CUSTOMER\s*\d+\s*===/i).filter((b) => b.trim());
    if (altBlocks.length > 1) {
      emailBlocks = altBlocks;
    } else {
      // Fallback: try to find multiple SUBJECT: lines
      const subjectMatches = [...text.matchAll(/^SUBJECT:\s*.+$/gm)];
      if (subjectMatches.length > 1) {
        const emails: ParsedEmail[] = [];
        for (let i = 0; i < subjectMatches.length; i++) {
          const start = subjectMatches[i].index!;
          const end = i < subjectMatches.length - 1 ? subjectMatches[i + 1].index! : text.length;
          emails.push(parseSingleEmail(text.slice(start, end)));
        }
        emailBlocks = []; // signal to use emails array below
        // Pad if needed
        return padEmails(emails, expectedCount);
      }

      // Last resort: just parse as one email — pad remaining
      return padEmails([parseSingleEmail(text)], expectedCount);
    }
  }

  const emails = emailBlocks.map((block) => parseSingleEmail(block));
  return padEmails(emails, expectedCount);
}

/**
 * Ensure the parsed email array has at least `expectedCount` entries.
 * Missing entries are filled with placeholder variants so every customer
 * gets a row that the user can regenerate from the UI.
 */
function padEmails(emails: ParsedEmail[], expectedCount: number): ParsedEmail[] {
  if (emails.length >= expectedCount) return emails;

  console.warn(`[campaign-engine] Parsed ${emails.length} emails but expected ${expectedCount}. Padding with placeholders.`);
  while (emails.length < expectedCount) {
    emails.push({
      subject_line: "(Email generation incomplete — please regenerate)",
      preview_text: "",
      body_html: "<p>This email could not be generated automatically. Please click <strong>Regenerate</strong> to retry, or edit manually.</p>",
      body_text: "This email could not be generated automatically. Please regenerate or edit manually.",
    });
  }
  return emails;
}

function parseSingleEmail(text: string): ParsedEmail {
  // Remove === END === marker and any trailing markers
  text = text.replace(/===\s*END\s*===/gi, "").trim();

  // Strip any text before the SUBJECT: line (Claude sometimes adds intro text within a block)
  const subjectIdx = text.search(/^SUBJECT:\s/m);
  if (subjectIdx > 0) {
    text = text.slice(subjectIdx);
  }

  const subjectMatch = text.match(/^SUBJECT:\s*(.+)$/m);
  const subject_line = subjectMatch?.[1]?.trim() ?? "No subject";

  const previewMatch = text.match(/^PREVIEW:\s*(.+)$/m);
  const preview_text = previewMatch?.[1]?.trim() ?? "";

  const htmlMatch = text.match(/---BODY_HTML---\s*([\s\S]*?)(?=---BODY_TEXT---|===\s*E(?:ND|MAIL)|$)/);
  const body_html = htmlMatch?.[1]?.trim() ?? "";

  const textMatch = text.match(/---BODY_TEXT---\s*([\s\S]*?)(?=---PERSONALIZATION---|===\s*E(?:ND|MAIL)|$)/);
  const body_text = textMatch?.[1]?.trim() ?? "";

  return { subject_line, preview_text, body_html, body_text };
}

/* ── Internal: Template Wrapping ───────────────────────── */

/**
 * Wrap AI-generated content in a brand template HTML.
 * Looks for {{CONTENT}} or <!--CONTENT--> placeholder in template.
 */
export function wrapContentInTemplate(content: string, templateHtml: string): string {
  // Try common content placeholders
  if (templateHtml.includes("{{CONTENT}}")) {
    return templateHtml.replace("{{CONTENT}}", content);
  }
  if (templateHtml.includes("<!-- CONTENT -->")) {
    return templateHtml.replace("<!-- CONTENT -->", content);
  }
  if (templateHtml.includes("<!--CONTENT-->")) {
    return templateHtml.replace("<!--CONTENT-->", content);
  }
  // Try replacing a content div
  const contentDivMatch = templateHtml.match(/<div[^>]*id=["']?content["']?[^>]*>[\s\S]*?<\/div>/i);
  if (contentDivMatch) {
    return templateHtml.replace(contentDivMatch[0], `<div id="content">${content}</div>`);
  }
  // Try replacing body content
  const bodyMatch = templateHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return templateHtml.replace(bodyMatch[1], content);
  }
  // Fallback: just use the content as-is
  return content;
}

/* ── Internal: Helpers ─────────────────────────────────── */

async function resolveDeliveryConfig(
  supabase: SupabaseClient,
  orgId: string,
  channel: DeliveryChannel
): Promise<Record<string, unknown>> {
  if (channel === "klaviyo") {
    const config = await loadKlaviyoConfig(supabase, orgId);
    if (!config) throw new Error("Klaviyo is not connected. Please connect Klaviyo first.");
    return config as unknown as Record<string, unknown>;
  }

  // For future providers, load from data_connectors
  const { data: connector } = await supabase
    .from("data_connectors")
    .select("config")
    .eq("org_id", orgId)
    .eq("connector_type", channel)
    .eq("status", "connected")
    .maybeSingle();

  if (!connector?.config) {
    throw new Error(`${channel} is not connected. Please connect it first.`);
  }

  return connector.config as Record<string, unknown>;
}

async function loadBrandAssets(
  supabase: SupabaseClient,
  orgId: string,
  templateId: string | null
): Promise<EmailBrandAsset[]> {
  if (templateId) {
    const { data } = await supabase
      .from("email_brand_assets")
      .select("*")
      .eq("org_id", orgId)
      .or(`id.eq.${templateId},asset_type.neq.html_template`)
      .limit(10);
    return (data ?? []) as unknown as EmailBrandAsset[];
  }

  // Default: load all brand assets
  const { data } = await supabase
    .from("email_brand_assets")
    .select("*")
    .eq("org_id", orgId)
    .limit(10);
  return (data ?? []) as unknown as EmailBrandAsset[];
}

/** Batch query a table with `.in()` — handles >100 IDs by chunking */
async function batchQuery<T>(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  select: string,
  orgId: string,
  idColumn = "id"
): Promise<T[]> {
  const CHUNK = 100;
  const results: T[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data } = await supabase
      .from(table)
      .select(select)
      .eq("org_id", orgId)
      .in(idColumn, chunk);
    if (data) results.push(...(data as T[]));
  }

  return results;
}

function summarizeProducts(
  products: Array<{ title: string; quantity: number; price: number }>
): string {
  if (products.length === 0) return "";

  // Group by title, sum quantities
  const grouped = new Map<string, { quantity: number; price: number }>();
  for (const p of products) {
    const existing = grouped.get(p.title);
    if (existing) {
      existing.quantity += p.quantity;
    } else {
      grouped.set(p.title, { quantity: p.quantity, price: p.price });
    }
  }

  // Format top 5 products
  return Array.from(grouped.entries())
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 5)
    .map(([title, { quantity, price }]) => `${quantity}x ${title} ($${price.toFixed(2)})`)
    .join(", ");
}
