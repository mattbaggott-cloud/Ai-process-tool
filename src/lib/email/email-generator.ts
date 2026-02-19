import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type {
  EmailBrandAsset,
  EmailGeneratedContent,
  EmailType,
  BrandAssetType,
  Segment,
  CustomerBehavioralProfile,
} from "@/lib/types/database";

/* ── Types ─────────────────────────────────────────────── */

export interface GenerateEmailInput {
  segmentId?: string;
  emailType: EmailType;
  prompt: string;
  name?: string;
  brandAssetIds?: string[];
  includeAllAssets?: boolean;
}

export interface GenerateEmailResult {
  id: string;
  name: string;
  subject_line: string;
  preview_text: string;
  body_html: string;
  body_text: string;
  personalization_fields: string[];
  segment_name?: string;
}

export interface SaveBrandAssetInput {
  name: string;
  assetType: BrandAssetType;
  contentText?: string;
  contentHtml?: string;
  storagePath?: string;
  mimeType?: string;
  fileSize?: number;
  metadata?: Record<string, unknown>;
}

/* ── Brand Asset Management ────────────────────────────── */

export async function saveBrandAsset(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: SaveBrandAssetInput
): Promise<EmailBrandAsset> {
  const { data, error } = await supabase
    .from("email_brand_assets")
    .insert({
      org_id: orgId,
      name: input.name,
      asset_type: input.assetType,
      content_text: input.contentText ?? null,
      content_html: input.contentHtml ?? null,
      storage_path: input.storagePath ?? null,
      mime_type: input.mimeType ?? null,
      file_size: input.fileSize ?? null,
      metadata: input.metadata ?? {},
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save brand asset: ${error?.message}`);
  }

  return data as unknown as EmailBrandAsset;
}

export async function listBrandAssets(
  supabase: SupabaseClient,
  orgId: string,
  options?: { assetType?: BrandAssetType }
): Promise<EmailBrandAsset[]> {
  let query = supabase
    .from("email_brand_assets")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (options?.assetType) {
    query = query.eq("asset_type", options.assetType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list brand assets: ${error.message}`);
  return (data ?? []) as unknown as EmailBrandAsset[];
}

export async function deleteBrandAsset(
  supabase: SupabaseClient,
  orgId: string,
  assetId: string
): Promise<void> {
  // Get the asset first to check for storage files
  const { data: asset } = await supabase
    .from("email_brand_assets")
    .select("storage_path")
    .eq("id", assetId)
    .eq("org_id", orgId)
    .single();

  // Delete from storage if applicable
  if (asset?.storage_path) {
    await supabase.storage
      .from("library-files")
      .remove([asset.storage_path as string]);
  }

  const { error } = await supabase
    .from("email_brand_assets")
    .delete()
    .eq("id", assetId)
    .eq("org_id", orgId);

  if (error) throw new Error(`Failed to delete brand asset: ${error.message}`);
}

/* ── Email Content Generation ──────────────────────────── */

export async function generateEmailContent(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: GenerateEmailInput
): Promise<GenerateEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  // 1. Load brand assets for context
  let brandAssets: EmailBrandAsset[] = [];
  if (input.brandAssetIds && input.brandAssetIds.length > 0) {
    const { data } = await supabase
      .from("email_brand_assets")
      .select("*")
      .eq("org_id", orgId)
      .in("id", input.brandAssetIds);
    brandAssets = (data ?? []) as unknown as EmailBrandAsset[];
  } else if (input.includeAllAssets !== false) {
    // Default: include all brand assets for style reference
    const { data } = await supabase
      .from("email_brand_assets")
      .select("*")
      .eq("org_id", orgId)
      .limit(10);
    brandAssets = (data ?? []) as unknown as EmailBrandAsset[];
  }

  // 2. Load segment context if provided
  let segmentContext: Record<string, unknown> = {};
  let segmentName = "";
  if (input.segmentId) {
    const { data: segment } = await supabase
      .from("segments")
      .select("*")
      .eq("id", input.segmentId)
      .eq("org_id", orgId)
      .single();

    if (segment) {
      const seg = segment as unknown as Segment;
      segmentName = seg.name;
      segmentContext = {
        name: seg.name,
        type: seg.segment_type,
        rules: seg.rules,
        member_count: seg.customer_count,
        branch_dimension: seg.branch_dimension,
        branch_value: seg.branch_value,
        description: seg.description,
      };

      // Get aggregate behavioral profile for the segment
      const { data: memberIds } = await supabase
        .from("segment_members")
        .select("ecom_customer_id")
        .eq("segment_id", input.segmentId)
        .limit(200);

      const custIds = (memberIds ?? []).map((m) => m.ecom_customer_id as string);
      const { data: profiles } = custIds.length > 0
        ? await supabase
            .from("customer_behavioral_profiles")
            .select("lifecycle_stage, inferred_comm_style, avg_interval_days, top_product_type, top_product_title")
            .eq("org_id", orgId)
            .in("ecom_customer_id", custIds)
        : { data: [] as Record<string, unknown>[] };

      if (profiles && profiles.length > 0) {
        // Aggregate the behavioral data
        const stages: Record<string, number> = {};
        const styles: Record<string, number> = {};
        const products: Record<string, number> = {};
        let totalInterval = 0;
        let intervalCount = 0;

        for (const p of profiles) {
          const stage = (p.lifecycle_stage as string) || "unknown";
          stages[stage] = (stages[stage] ?? 0) + 1;
          const style = (p.inferred_comm_style as string) || "unknown";
          styles[style] = (styles[style] ?? 0) + 1;
          const prod = (p.top_product_type as string) || "unknown";
          products[prod] = (products[prod] ?? 0) + 1;
          if (p.avg_interval_days) {
            totalInterval += p.avg_interval_days as number;
            intervalCount++;
          }
        }

        segmentContext.behavioral_summary = {
          lifecycle_stages: stages,
          communication_styles: styles,
          top_product_types: products,
          avg_purchase_interval_days: intervalCount > 0 ? Math.round(totalInterval / intervalCount) : null,
          profile_count: profiles.length,
        };
      }
    }
  }

  // 3. Load org context for brand info
  const { data: org } = await supabase
    .from("org_profiles")
    .select("name, description, industry, target_market")
    .eq("org_id", orgId)
    .single();

  // 4. Build the generation prompt
  const systemPrompt = buildGenerationPrompt(
    org as Record<string, unknown> | null,
    brandAssets,
    segmentContext,
    input.emailType
  );

  // 5. Call Claude to generate
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: input.prompt }],
  });

  // Parse the response
  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseGeneratedEmail(responseText);

  // 6. Save to database
  const emailName = input.name || `${EMAIL_TYPE_LABELS[input.emailType]} - ${segmentName || "All Customers"}`;

  const { data: saved, error: saveErr } = await supabase
    .from("email_generated_content")
    .insert({
      org_id: orgId,
      segment_id: input.segmentId ?? null,
      name: emailName,
      status: "draft",
      email_type: input.emailType,
      subject_line: parsed.subject_line,
      preview_text: parsed.preview_text,
      body_html: parsed.body_html,
      body_text: parsed.body_text,
      prompt_used: input.prompt,
      brand_asset_ids: input.brandAssetIds ?? [],
      segment_context: segmentContext,
      generation_model: "claude-sonnet-4-20250514",
      personalization_fields: parsed.personalization_fields,
      created_by: userId,
    })
    .select()
    .single();

  if (saveErr || !saved) {
    throw new Error(`Failed to save generated email: ${saveErr?.message}`);
  }

  return {
    id: saved.id as string,
    name: emailName,
    subject_line: parsed.subject_line,
    preview_text: parsed.preview_text,
    body_html: parsed.body_html,
    body_text: parsed.body_text,
    personalization_fields: parsed.personalization_fields,
    segment_name: segmentName || undefined,
  };
}

/* ── List Generated Emails ─────────────────────────────── */

export async function listGeneratedEmails(
  supabase: SupabaseClient,
  orgId: string,
  options?: { segmentId?: string; status?: string; limit?: number }
): Promise<EmailGeneratedContent[]> {
  let query = supabase
    .from("email_generated_content")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.segmentId) query = query.eq("segment_id", options.segmentId);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list emails: ${error.message}`);
  return (data ?? []) as unknown as EmailGeneratedContent[];
}

/* ── Get Single Email ──────────────────────────────────── */

export async function getGeneratedEmail(
  supabase: SupabaseClient,
  orgId: string,
  emailId: string
): Promise<EmailGeneratedContent | null> {
  const { data, error } = await supabase
    .from("email_generated_content")
    .select("*")
    .eq("id", emailId)
    .eq("org_id", orgId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get email: ${error.message}`);
  }
  return (data as unknown as EmailGeneratedContent) ?? null;
}

/* ── Update Email Status ───────────────────────────────── */

export async function updateEmailStatus(
  supabase: SupabaseClient,
  orgId: string,
  emailId: string,
  status: "draft" | "approved" | "sent" | "archived"
): Promise<void> {
  const { error } = await supabase
    .from("email_generated_content")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", emailId)
    .eq("org_id", orgId);

  if (error) throw new Error(`Failed to update email status: ${error.message}`);
}

/* ── Get Email + Brand Asset Summary for System Prompt ─── */

export async function getEmailSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ totalEmails: number; byStatus: Record<string, number>; brandAssetCount: number }> {
  const empty = { totalEmails: 0, byStatus: {} as Record<string, number>, brandAssetCount: 0 };

  try {
    const [emailRes, assetRes] = await Promise.all([
      supabase
        .from("email_generated_content")
        .select("status")
        .eq("org_id", orgId),
      supabase
        .from("email_brand_assets")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
    ]);

    if (emailRes.error && assetRes.error) return empty;

    const byStatus: Record<string, number> = {};
    for (const e of emailRes.data ?? []) {
      const s = (e.status as string) || "draft";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    return {
      totalEmails: emailRes.data?.length ?? 0,
      byStatus,
      brandAssetCount: assetRes.count ?? 0,
    };
  } catch {
    return empty;
  }
}

/* ── Internal: Build Generation System Prompt ──────────── */

const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  promotional: "Promotional",
  win_back: "Win-Back",
  nurture: "Nurture Sequence",
  announcement: "Announcement",
  educational: "Educational",
  milestone: "Milestone/Celebration",
  custom: "Custom",
};

function buildGenerationPrompt(
  org: Record<string, unknown> | null,
  brandAssets: EmailBrandAsset[],
  segmentContext: Record<string, unknown>,
  emailType: EmailType
): string {
  let prompt = `You are an expert email marketing copywriter. Generate a ${EMAIL_TYPE_LABELS[emailType]} email.

## Output Format
You MUST structure your response exactly like this:

SUBJECT: [subject line here]
PREVIEW: [preview text / preheader here, 40-90 chars]
---BODY_HTML---
[full email HTML body here — use clean, modern HTML with inline styles for email compatibility]
---BODY_TEXT---
[plain text version of the email]
---PERSONALIZATION---
[comma-separated list of personalization fields used, e.g. first_name, product_name]

## Rules
- Write compelling, conversion-focused copy
- Use personalization tokens in {{double_braces}} format (e.g. {{first_name}}, {{product_name}})
- Keep subject lines under 60 characters
- Preview text should complement (not repeat) the subject line
- HTML should be email-safe (inline styles, table layout for complex designs, no external CSS)
- Include a clear CTA (call to action)
- The tone and style should match the brand assets provided below
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
    prompt += `\n## Brand Assets & Style Reference\n`;
    prompt += `The user has uploaded these brand assets. Match their tone, voice, formatting patterns, and visual style:\n\n`;

    for (const asset of brandAssets) {
      prompt += `### ${asset.name} (${asset.asset_type})\n`;

      if (asset.metadata && Object.keys(asset.metadata).length > 0) {
        const meta = asset.metadata;
        if (meta.tone) prompt += `**Tone:** ${meta.tone}\n`;
        if (meta.source_tool) prompt += `**Source:** ${meta.source_tool}\n`;
        if (meta.tags) prompt += `**Tags:** ${Array.isArray(meta.tags) ? (meta.tags as string[]).join(", ") : meta.tags}\n`;
        if (meta.notes) prompt += `**Notes:** ${meta.notes}\n`;
      }

      if (asset.content_text) {
        const truncated = asset.content_text.length > 2000
          ? asset.content_text.slice(0, 2000) + "\n...(truncated)"
          : asset.content_text;
        prompt += `\`\`\`\n${truncated}\n\`\`\`\n`;
      }

      if (asset.content_html) {
        const truncated = asset.content_html.length > 3000
          ? asset.content_html.slice(0, 3000) + "\n...(truncated)"
          : asset.content_html;
        prompt += `**HTML Template:**\n\`\`\`html\n${truncated}\n\`\`\`\n`;
      }

      prompt += `\n`;
    }
  }

  // Add segment context
  if (Object.keys(segmentContext).length > 0) {
    prompt += `\n## Target Segment\n`;
    if (segmentContext.name) prompt += `**Segment:** ${segmentContext.name}\n`;
    if (segmentContext.description) prompt += `**Description:** ${segmentContext.description}\n`;
    if (segmentContext.member_count) prompt += `**Size:** ${segmentContext.member_count} customers\n`;
    if (segmentContext.branch_dimension) {
      prompt += `**Branch:** ${segmentContext.branch_dimension} = ${segmentContext.branch_value}\n`;
    }

    const behavioral = segmentContext.behavioral_summary as Record<string, unknown> | undefined;
    if (behavioral) {
      prompt += `\n### Behavioral Profile\n`;
      if (behavioral.lifecycle_stages) {
        prompt += `**Lifecycle stages:** ${JSON.stringify(behavioral.lifecycle_stages)}\n`;
      }
      if (behavioral.communication_styles) {
        prompt += `**Communication styles:** ${JSON.stringify(behavioral.communication_styles)}\n`;
        prompt += `*Adapt your writing style to match the dominant communication preference.*\n`;
      }
      if (behavioral.top_product_types) {
        prompt += `**Top product types:** ${JSON.stringify(behavioral.top_product_types)}\n`;
      }
      if (behavioral.avg_purchase_interval_days) {
        prompt += `**Avg purchase interval:** ${behavioral.avg_purchase_interval_days} days\n`;
      }
    }
  }

  return prompt;
}

/* ── Internal: Parse Claude Response ───────────────────── */

function parseGeneratedEmail(text: string): {
  subject_line: string;
  preview_text: string;
  body_html: string;
  body_text: string;
  personalization_fields: string[];
} {
  // Extract subject
  const subjectMatch = text.match(/^SUBJECT:\s*(.+)$/m);
  const subject_line = subjectMatch?.[1]?.trim() ?? "No subject";

  // Extract preview
  const previewMatch = text.match(/^PREVIEW:\s*(.+)$/m);
  const preview_text = previewMatch?.[1]?.trim() ?? "";

  // Extract HTML body
  const htmlMatch = text.match(/---BODY_HTML---\s*([\s\S]*?)(?=---BODY_TEXT---|$)/);
  const body_html = htmlMatch?.[1]?.trim() ?? "";

  // Extract text body
  const textMatch = text.match(/---BODY_TEXT---\s*([\s\S]*?)(?=---PERSONALIZATION---|$)/);
  const body_text = textMatch?.[1]?.trim() ?? "";

  // Extract personalization fields
  const persMatch = text.match(/---PERSONALIZATION---\s*(.+)/);
  const personalization_fields = persMatch?.[1]
    ?.split(",")
    .map((f) => f.trim())
    .filter(Boolean) ?? [];

  return { subject_line, preview_text, body_html, body_text, personalization_fields };
}
