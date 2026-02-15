/**
 * Re-embed all existing data into document_chunks.
 *
 * Usage:
 *   SUPABASE_EMAIL="you@example.com" SUPABASE_PASSWORD="pass" \
 *   OPENAI_API_KEY="sk-..." \
 *   node scripts/reembed-all.mjs
 *
 * Iterates through goals, sub_goals, pain_points, library_items,
 * library_files, organization_files, and team_files — chunks and
 * embeds each record. Idempotent via upsert on unique constraint.
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

/* ── Config ─────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ctysnqunalosgcjnojtk.supabase.co";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eXNucXVuYWxvc2djam5vanRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0ODUsImV4cCI6MjA4NTk2NTQ4NX0.cp--xL8D8Q7WeCpSwdkaBExa27qsbRTn8J-7wZ4XN9s";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY env var is required");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ── Chunking ───────────────────────────────────────── */

function chunkText(text, maxSize = 1000, overlap = 200) {
  if (!text || text.length <= maxSize) return [text || ""];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxSize, text.length);
    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(". ", end);
      if (lastPeriod > start + maxSize / 2) end = lastPeriod + 2;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

function buildChunks(sourceTable, sourceId, record) {
  const chunks = [];

  switch (sourceTable) {
    case "goals": {
      const parts = [
        record.name,
        record.description,
        record.status && `Status: ${record.status}`,
        record.owner && `Owner: ${record.owner}`,
        record.metric && `Metric: ${record.metric}`,
        record.metric_target && `Target: ${record.metric_target}`,
        record.teams?.length && `Teams: ${record.teams.join(", ")}`,
      ].filter(Boolean);
      chunks.push({
        index: 0,
        text: parts.join("\n"),
        metadata: { name: record.name, status: record.status, owner: record.owner },
      });
      break;
    }
    case "sub_goals": {
      const parts = [
        record.name,
        record.description,
        record.status && `Status: ${record.status}`,
        record.owner && `Owner: ${record.owner}`,
        record.end_date && `Due: ${record.end_date}`,
      ].filter(Boolean);
      chunks.push({
        index: 0,
        text: parts.join("\n"),
        metadata: { name: record.name, status: record.status, goal_id: record.goal_id },
      });
      break;
    }
    case "pain_points": {
      const parts = [
        record.name,
        record.description,
        record.severity && `Severity: ${record.severity}`,
        record.status && `Status: ${record.status}`,
        record.owner && `Owner: ${record.owner}`,
        record.impact_metric && `Impact: ${record.impact_metric}`,
        record.teams?.length && `Teams: ${record.teams.join(", ")}`,
      ].filter(Boolean);
      chunks.push({
        index: 0,
        text: parts.join("\n"),
        metadata: { name: record.name, severity: record.severity, status: record.status },
      });
      break;
    }
    case "library_items": {
      const fullText = [record.title, record.content].filter(Boolean).join("\n\n");
      const textChunks = chunkText(fullText, 1000, 200);
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          index: i,
          text: textChunks[i],
          metadata: { title: record.title, category: record.category, tags: record.tags },
        });
      }
      break;
    }
    case "library_files":
    case "organization_files":
    case "team_files": {
      const content = record.text_content;
      if (!content) return [];
      const textChunks = chunkText(content, 1000, 200);
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          index: i,
          text: textChunks[i],
          metadata: { name: record.name },
        });
      }
      break;
    }
  }

  return chunks;
}

/* ── Embedding ──────────────────────────────────────── */

async function getEmbeddings(texts) {
  // Sanitize
  const cleaned = texts.map((t) => t.replace(/\n/g, " ").trim().slice(0, 8000));
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: cleaned,
  });
  return res.data.map((d) => d.embedding);
}

/* ── Main ───────────────────────────────────────────── */

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Auth
const email = process.env.SUPABASE_EMAIL;
const password = process.env.SUPABASE_PASSWORD;

if (!email || !password) {
  console.error(
    "Set SUPABASE_EMAIL and SUPABASE_PASSWORD env vars.\n" +
    'Example: SUPABASE_EMAIL="you@example.com" SUPABASE_PASSWORD="pass" node scripts/reembed-all.mjs'
  );
  process.exit(1);
}

const { data: authData, error: authError } =
  await supabase.auth.signInWithPassword({ email, password });

if (authError) {
  console.error("Auth failed:", authError.message);
  process.exit(1);
}

const userId = authData.user.id;
console.log(`Authenticated as ${email} (${userId})\n`);

// Tables to process
const TABLES = [
  { name: "goals", select: "*" },
  { name: "sub_goals", select: "*" },
  { name: "pain_points", select: "*" },
  { name: "library_items", select: "*" },
  { name: "library_files", select: "id, name, text_content" },
  { name: "organization_files", select: "id, name, text_content" },
  { name: "team_files", select: "id, name, text_content" },
];

let totalChunks = 0;
let totalRecords = 0;

for (const table of TABLES) {
  console.log(`\n── ${table.name} ──`);

  const { data: records, error } = await supabase
    .from(table.name)
    .select(table.select);

  if (error) {
    console.error(`  Error fetching: ${error.message}`);
    continue;
  }

  if (!records || records.length === 0) {
    console.log("  No records found");
    continue;
  }

  console.log(`  Found ${records.length} records`);

  // Process in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      const chunks = buildChunks(table.name, record.id, record);
      if (chunks.length === 0) continue;

      try {
        // Get embeddings
        const embeddings = await getEmbeddings(chunks.map((c) => c.text));

        // Build rows
        const rows = chunks.map((chunk, j) => ({
          user_id: userId,
          source_table: table.name,
          source_id: record.id,
          source_field: "content",
          chunk_index: chunk.index,
          chunk_text: chunk.text,
          metadata: chunk.metadata,
          embedding: JSON.stringify(embeddings[j]),
          updated_at: new Date().toISOString(),
        }));

        // Upsert
        const { error: upsertError } = await supabase
          .from("document_chunks")
          .upsert(rows, {
            onConflict: "source_table,source_id,source_field,chunk_index",
          });

        if (upsertError) {
          console.error(`  Error upserting ${record.id}: ${upsertError.message}`);
        } else {
          totalChunks += chunks.length;
          totalRecords++;
          process.stdout.write(`  Embedded ${record.id} (${chunks.length} chunk${chunks.length > 1 ? "s" : ""})\n`);
        }
      } catch (err) {
        console.error(`  Error processing ${record.id}: ${err.message}`);
      }
    }

    // Rate limiting: 500ms delay between batches
    if (i + BATCH_SIZE < records.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`Done! Embedded ${totalRecords} records → ${totalChunks} chunks`);
console.log(`${"═".repeat(50)}\n`);
