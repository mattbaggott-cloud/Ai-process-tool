/**
 * Seed the tool_catalog table from a CSV file.
 *
 * Usage:
 *   node scripts/seed-catalog.mjs /path/to/catalog.csv
 *
 * Reads the CSV, maps columns to the tool_catalog schema, and bulk-inserts.
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * and SUPABASE_USER_ID env vars (or edit the constants below).
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

/* ── Config ─────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ctysnqunalosgcjnojtk.supabase.co";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eXNucXVuYWxvc2djam5vanRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0ODUsImV4cCI6MjA4NTk2NTQ4NX0.cp--xL8D8Q7WeCpSwdkaBExa27qsbRTn8J-7wZ4XN9s";

// Category normalization: CSV value → DB value
const CATEGORY_MAP = {
  "GTM & Sales": "GTM",
  Marketing: "Marketing",
  "AI/ML & LLMs": "AI/ML",
};

/* ── CSV parser (handles quoted fields with commas) ─── */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function splitPipe(val) {
  if (!val || !val.trim()) return [];
  return val.split("|").map((s) => s.trim()).filter(Boolean);
}

/* ── Main ───────────────────────────────────────────── */
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/seed-catalog.mjs <path-to-csv>");
  process.exit(1);
}

const raw = readFileSync(csvPath, "utf-8");
const lines = raw.split("\n").filter((l) => l.trim());
const headers = parseCSVLine(lines[0]);

console.log("Headers:", headers);
console.log(`Parsing ${lines.length - 1} rows...\n`);

// Build header index map
const idx = {};
headers.forEach((h, i) => (idx[h.toLowerCase().trim()] = i));

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]);
  const rawCat = cols[idx["category"]] || "";
  const category = CATEGORY_MAP[rawCat] || rawCat;

  rows.push({
    name: cols[idx["name"]] || "",
    category,
    subcategory: cols[idx["subcategory"]] || "",
    description: cols[idx["description"]] || "",
    key_features: splitPipe(cols[idx["key_features"]]),
    pricing: cols[idx["pricing"]] || "",
    best_for: cols[idx["best_for"]] || "",
    integrations: splitPipe(cols[idx["integrations"]]),
    pros: splitPipe(cols[idx["pros"]]),
    cons: splitPipe(cols[idx["cons"]]),
    website: cols[idx["website"]] || "",
  });
}

console.log(`Parsed ${rows.length} tools.`);
console.log("Categories:", [...new Set(rows.map((r) => r.category))]);
console.log("Sample:", JSON.stringify(rows[0], null, 2));

// Connect to Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// We need a user_id for RLS. Sign in or use the service role.
// For now, prompt user to sign in so RLS works.
const email = process.env.SUPABASE_EMAIL;
const password = process.env.SUPABASE_PASSWORD;

if (!email || !password) {
  console.error(
    "\nSet SUPABASE_EMAIL and SUPABASE_PASSWORD env vars to authenticate.\n" +
      "Example:\n" +
      '  SUPABASE_EMAIL="you@example.com" SUPABASE_PASSWORD="yourpass" node scripts/seed-catalog.mjs catalog.csv'
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
console.log(`\nAuthenticated as ${email} (${userId})`);

// Add user_id to each row
const insertRows = rows.map((r) => ({ ...r, user_id: userId }));

// Insert in batches of 50
const BATCH = 50;
let inserted = 0;
for (let i = 0; i < insertRows.length; i += BATCH) {
  const batch = insertRows.slice(i, i + BATCH);
  const { error } = await supabase.from("tool_catalog").insert(batch);
  if (error) {
    console.error(`Batch ${i / BATCH + 1} failed:`, error.message);
    // Continue with remaining batches
  } else {
    inserted += batch.length;
    console.log(`Inserted batch ${Math.floor(i / BATCH) + 1}: ${batch.length} rows`);
  }
}

console.log(`\nDone! Inserted ${inserted} / ${rows.length} tools into tool_catalog.`);
