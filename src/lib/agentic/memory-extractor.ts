/**
 * Memory Extractor — analyzes conversations to extract persistent memories.
 * Runs after each chat session completes (fire-and-forget).
 *
 * Extracts: preferences, facts, corrections, insights, patterns, procedures.
 * Deduplicates against existing memories via embedding similarity.
 * Supersedes old memories when corrections are detected.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding } from "@/lib/embeddings/client";
import { emitEventInBackground } from "./event-emitter";

/* ── Types ── */

interface ExtractedMemory {
  content: string;
  memory_type: "fact" | "preference" | "procedure" | "insight" | "pattern" | "correction" | "relationship";
  scope_type: "org" | "user" | "team";
  subject?: string;
  predicate?: string;
  object?: string;
  confidence: number;
  is_correction?: boolean;
  corrects?: string; // content of the memory being corrected
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/* ── Extraction Prompt ── */

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze this conversation and extract ALL factual memories that should persist across future conversations.

Your job is to capture EVERYTHING the user tells you — business facts, personal details, preferences, corrections, anything. If the user said it, it matters. Extract every discrete fact as its own separate memory.

## Memory Types

1. **Preferences**: User or org preferences — currency, format, naming conventions, communication style, scheduling preferences, timezone, language
2. **Facts**: Any factual statement — business facts (sales cycle length, target market, pricing strategy) AND personal facts (name details, location, background, interests, role)
3. **Corrections**: When the user corrects the AI's assumption or output ("No, we use EUR not USD", "Actually our cycle is 60 days not 30")
4. **Insights**: Insights the user shares ("Our enterprise deals always stall at legal review", "I work best in the mornings")
5. **Patterns**: Observed patterns ("This user always asks about pipeline first")
6. **Procedures**: How things should be done ("Always CC the manager when updating deal stages above $100k")
7. **Relationships**: Relationships mentioned — business ("Sarah handles all Acme Corp deals") or personal ("My manager is Tom")

## CRITICAL: Compound Messages

Users often state multiple facts in a single message. You MUST extract EACH fact as a separate memory. Parse carefully.

Example input: "deal cycles are typically 60 days, and my middle name is Christopher"
Example output:
[
  {"content": "The typical deal cycle length is 60 days", "memory_type": "fact", "scope_type": "org", "subject": "deal_cycle", "predicate": "typical_length", "object": "60 days", "confidence": 1.0},
  {"content": "The user's middle name is Christopher", "memory_type": "fact", "scope_type": "user", "subject": "user", "predicate": "middle_name", "object": "Christopher", "confidence": 1.0}
]

Example input: "Our sales cycle is typically 60 days for enterprise deals, always include the company name in deal titles, and we don't use Salesforce we use HubSpot"
Example output:
[
  {"content": "Enterprise deal sales cycle is typically 60 days", "memory_type": "fact", "scope_type": "org", "subject": "enterprise_deals", "predicate": "sales_cycle", "object": "60 days", "confidence": 1.0},
  {"content": "Deal titles should always include the company name", "memory_type": "procedure", "scope_type": "org", "subject": "deal_titles", "predicate": "naming_convention", "object": "include company name", "confidence": 1.0},
  {"content": "The organization uses HubSpot, not Salesforce", "memory_type": "fact", "scope_type": "org", "subject": "organization", "predicate": "crm_platform", "object": "HubSpot", "confidence": 1.0}
]

## Output Format

For each memory, provide:
- content: Clear, standalone sentence (should make sense without conversation context)
- memory_type: One of the types above (fact, preference, procedure, insight, pattern, correction, relationship)
- scope_type: "org" (applies to whole organization), "user" (specific to this user), "team" (specific to a team)
- subject: Who/what this is about (optional)
- predicate: The relationship/attribute (optional)
- object: The value (optional)
- confidence: 0.0-1.0 (user explicitly stated = 1.0, AI inferred = 0.6-0.8)
- is_correction: true if this corrects a previous assumption
- corrects: if is_correction, what was the wrong assumption (as a search string)

## Rules
- Extract EVERY distinct fact, preference, or piece of information the user states
- If the user says multiple things in one message, extract EACH as a separate memory
- Personal facts about the user (name, location, timezone, interests) are VALID memories — scope_type "user"
- Do NOT extract memories that are just restating what tools returned (tool output is not user knowledge)
- Do NOT extract memories about CRM data the tools just fetched (e.g., "Contact John has email john@x.com" from a tool result)
- DO extract opinions, preferences, corrections, personal details, and business context the USER states
- Keep each memory as a single, clear sentence
- When in doubt, extract it — it's better to capture something unnecessary than to miss something important
- If no meaningful memories exist in this conversation, return an empty array

Respond with ONLY a JSON array of extracted memories. No other text.`;

/* ── Core Functions ── */

/**
 * Extract memories from a conversation.
 * Calls Claude to analyze the conversation and identify persistent facts.
 */
export async function extractMemories(
  messages: ConversationMessage[]
): Promise<ExtractedMemory[]> {
  // Filter to only meaningful exchanges (skip very short conversations)
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return [];

  // Build conversation text
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyze this conversation and extract memories:\n\n${conversationText}`,
        },
      ],
    });

    // Parse the response
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedMemory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Memory extraction failed:", err);
    return [];
  }
}

/**
 * Store extracted memories in the database.
 * Handles deduplication and supersession of old memories.
 */
export async function storeMemories(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  memories: ExtractedMemory[],
  sessionId?: string
): Promise<number> {
  let stored = 0;

  for (const memory of memories) {
    try {
      // Generate embedding for this memory
      const embedding = await getEmbedding(memory.content);

      // Check for existing similar memory (dedup via cosine similarity)
      const { data: similar, error: rpcError } = await supabase.rpc("retrieve_memories", {
        p_org_id: orgId,
        p_query_embedding: JSON.stringify(embedding),
        p_scope_types: [memory.scope_type],
        p_limit: 3,
        p_min_confidence: 0.1,
      });
      if (rpcError) {
        console.error("[Memory] retrieve_memories RPC error:", rpcError.message);
      }

      // If a very similar memory exists (similarity > 0.92), skip or supersede
      const duplicate = (similar ?? []).find(
        (s: { similarity: number }) => s.similarity > 0.92
      );

      if (duplicate && !memory.is_correction) {
        // Skip — memory already exists
        continue;
      }

      // If this is a correction, find and supersede the old memory
      if (memory.is_correction && memory.corrects) {
        const correctionEmbedding = await getEmbedding(memory.corrects);
        const { data: oldMemories } = await supabase.rpc("retrieve_memories", {
          p_org_id: orgId,
          p_query_embedding: JSON.stringify(correctionEmbedding),
          p_scope_types: ["org", "user", "team"],
          p_limit: 3,
          p_min_confidence: 0.1,
        });

        const toSupersede = (oldMemories ?? []).find(
          (m: { similarity: number }) => m.similarity > 0.75
        );

        if (toSupersede) {
          // Insert new memory first, then supersede old one
          const { data: newMemory } = await supabase
            .from("memories")
            .insert({
              org_id: orgId,
              scope_type: memory.scope_type,
              scope_id: memory.scope_type === "user" ? userId : null,
              memory_type: "correction",
              content: memory.content,
              subject: memory.subject ?? null,
              predicate: memory.predicate ?? null,
              object: memory.object ?? null,
              source_type: "ai_extraction",
              confidence: Math.min(memory.confidence + 0.1, 1.0), // Corrections get confidence boost
              embedding: JSON.stringify(embedding),
              importance: 0.7, // Corrections are important
              created_by: userId,
            })
            .select("id")
            .single();

          if (newMemory) {
            // Supersede the old memory
            await supabase
              .from("memories")
              .update({
                invalid_at: new Date().toISOString(),
                superseded_by: newMemory.id,
              })
              .eq("id", (toSupersede as { memory_id: string }).memory_id);
          }

          stored++;
          continue;
        }
      }

      // If duplicate exists, supersede it with updated version
      if (duplicate) {
        const { data: newMemory } = await supabase
          .from("memories")
          .insert({
            org_id: orgId,
            scope_type: memory.scope_type,
            scope_id: memory.scope_type === "user" ? userId : null,
            memory_type: memory.memory_type,
            content: memory.content,
            subject: memory.subject ?? null,
            predicate: memory.predicate ?? null,
            object: memory.object ?? null,
            source_type: "ai_extraction",
            confidence: memory.confidence,
            embedding: JSON.stringify(embedding),
            importance: 0.5,
            created_by: userId,
          })
          .select("id")
          .single();

        if (newMemory) {
          await supabase
            .from("memories")
            .update({
              invalid_at: new Date().toISOString(),
              superseded_by: newMemory.id,
            })
            .eq("id", (duplicate as { memory_id: string }).memory_id);
        }

        stored++;
        continue;
      }

      // No duplicate — insert new memory
      const { error: insertError } = await supabase.from("memories").insert({
        org_id: orgId,
        scope_type: memory.scope_type,
        scope_id: memory.scope_type === "user" ? userId : null,
        memory_type: memory.memory_type,
        content: memory.content,
        subject: memory.subject ?? null,
        predicate: memory.predicate ?? null,
        object: memory.object ?? null,
        source_type: "ai_extraction",
        confidence: memory.confidence,
        embedding: JSON.stringify(embedding),
        importance: 0.5,
        created_by: userId,
      });

      if (insertError) {
        console.error("[Memory] Insert failed:", insertError.message);
        continue;
      }

      stored++;
    } catch (err) {
      console.error("Failed to store memory:", err);
    }
  }

  // Emit event
  if (stored > 0) {
    emitEventInBackground(supabase, {
      org_id: orgId,
      event_type: "ai.memory.extracted",
      event_category: "ai",
      actor_type: "ai",
      actor_id: userId,
      session_id: sessionId ?? null,
      payload: {
        memories_extracted: memories.length,
        memories_stored: stored,
        memory_types: memories.map((m) => m.memory_type),
      },
    });
  }

  return stored;
}

/**
 * Full extraction pipeline: extract from conversation → store in DB.
 * Fire-and-forget — never blocks the caller.
 */
export function extractAndStoreMemoriesInBackground(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  messages: ConversationMessage[],
  sessionId?: string
): void {
  Promise.resolve()
    .then(async () => {
      console.log(`[Memory] Starting extraction for ${messages.length} messages...`);
      const memories = await extractMemories(messages);
      console.log(`[Memory] Extracted ${memories.length} memories:`, memories.map(m => m.content));
      if (memories.length > 0) {
        const stored = await storeMemories(supabase, orgId, userId, memories, sessionId);
        console.log(`[Memory] Stored ${stored} memories`);
      }
    })
    .catch((err) => console.error("[Memory] Background extraction failed:", err));
}
