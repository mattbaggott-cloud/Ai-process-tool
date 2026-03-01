/**
 * Website Analyzer — AI-powered company research
 *
 * Used during onboarding to extract structured company information from
 * a user-provided URL.
 *
 * Strategy (in order):
 * 1. Jina Reader API (r.jina.ai) — renders JS, bypasses bot protection, returns markdown
 * 2. Jina Search API (s.jina.ai) — web search fallback if direct read fails
 * 3. Direct fetch + HTML strip — last resort
 *
 * All methods feed content into Claude Haiku for structured extraction.
 */

import Anthropic from "@anthropic-ai/sdk";

/* ── Types ─────────────────────────────────────────────── */

export interface CompanyAnalysis {
  company_name: string;
  industry: string;
  business_model: "B2B" | "B2C" | "Both" | "Unknown";
  description: string;
  products_services: string[];
  target_audience: string;
  value_proposition: string;
  competitors: string[];
  stage: string; // e.g. "Startup", "Growth", "Enterprise", "Unknown"
  raw_summary: string; // 2-3 sentence plain-English summary
}

/* ── JSON extraction schema (shared prompt) ───────────── */

const JSON_SCHEMA = `{
  "company_name": "string — the company name",
  "industry": "string — primary industry (e.g. SaaS, E-commerce, Healthcare, FinTech, etc.)",
  "business_model": "B2B | B2C | Both | Unknown",
  "description": "string — 1-2 sentence company description",
  "products_services": ["array of products or services offered"],
  "target_audience": "string — who they sell to / who their customers are",
  "value_proposition": "string — their main value prop or positioning",
  "competitors": ["array of mentioned or implied competitors, or empty"],
  "stage": "Startup | Growth | Enterprise | Unknown",
  "raw_summary": "string — 2-3 sentence plain-English summary of the company"
}`;

/* ── JSON parsing helper ──────────────────────────────── */

function extractJson(text: string): CompanyAnalysis | null {
  let jsonStr = text.trim();

  // Handle markdown code blocks
  if (jsonStr.includes("```")) {
    const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) jsonStr = match[1].trim();
  }

  // Try to find a JSON object in the text
  if (!jsonStr.startsWith("{")) {
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as CompanyAnalysis;
    if (parsed.company_name && parsed.description) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/* ── URL normalization ─────────────────────────────────── */

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  return normalized;
}

/* ── Fetch with timeout helper ────────────────────────── */

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 20000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Send content to Claude for structured extraction ─── */

async function extractWithClaude(
  content: string,
  url: string,
  source: string
): Promise<CompanyAnalysis | null> {
  try {
    const truncated = content.length > 10000 ? content.slice(0, 10000) : content;
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Analyze this company information and extract structured data. Return ONLY valid JSON matching the schema below — no markdown fencing, no explanation, just the raw JSON object.

Schema:
${JSON_SCHEMA}

Important:
- For business_model, determine if they primarily sell to businesses (B2B), consumers (B2C), or Both
- For stage, infer from company size, funding, and market presence
- Be specific about products_services — list actual product/service names
- If you truly can't determine something, use "Unknown"

Source: ${source}
Website URL: ${url}

Content:
${truncated}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return extractJson(text);
  } catch (err) {
    console.error("[website-analyzer] Claude extraction failed:", err);
    return null;
  }
}

/* ── Method 1: Jina Reader API ────────────────────────── */

async function readViaJina(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetchWithTimeout(jinaUrl, {
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
      },
    });

    if (!response.ok) {
      console.error(`[website-analyzer] Jina Reader returned ${response.status}`);
      return null;
    }

    const markdown = await response.text();
    // Jina returns markdown — check we got real content
    if (markdown.length < 100) return null;
    return markdown;
  } catch (err) {
    console.error("[website-analyzer] Jina Reader failed:", err);
    return null;
  }
}

/* ── Method 2: Direct fetch (fallback) ─────────────────── */

async function readViaDirect(url: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    }, 15000);

    if (!response.ok) return null;

    const html = await response.text();
    // Strip HTML to plain text
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<!--[\s\S]*?-->/g, " ");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ");
    text = text.replace(/\s+/g, " ").trim();

    if (text.length < 50) return null;
    return text;
  } catch (err) {
    console.error("[website-analyzer] Direct fetch failed:", err);
    return null;
  }
}

/* ── Main analyzer ─────────────────────────────────────── */

export async function analyzeCompanyWebsite(
  url: string
): Promise<
  { success: true; analysis: CompanyAnalysis } | { success: false; error: string }
> {
  const normalizedUrl = normalizeUrl(url);

  // Method 1: Jina Reader — renders JS, bypasses bot protection, free
  console.log(`[website-analyzer] Trying Jina Reader for ${normalizedUrl}`);
  const jinaContent = await readViaJina(normalizedUrl);
  if (jinaContent) {
    const analysis = await extractWithClaude(jinaContent, normalizedUrl, "Jina Reader (rendered page)");
    if (analysis) return { success: true, analysis };
  }

  // Method 2: Direct fetch — fallback
  console.log(`[website-analyzer] Trying direct fetch for ${normalizedUrl}`);
  const directContent = await readViaDirect(normalizedUrl);
  if (directContent) {
    const analysis = await extractWithClaude(directContent, normalizedUrl, "Direct HTML fetch");
    if (analysis) return { success: true, analysis };
  }

  // All methods failed
  return {
    success: false,
    error:
      "I wasn't able to pull information from that website. Could you tell me about your company instead? What do you do, who are your customers, and what industry are you in?",
  };
}
