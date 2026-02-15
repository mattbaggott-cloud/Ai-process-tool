/**
 * OpenAI embedding client — wraps text-embedding-3-small
 * Used for RAG: converts text → 1536-dimension vectors
 */

import OpenAI from "openai";

const MODEL = "text-embedding-3-small";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/** Sanitize text before embedding */
function sanitize(text: string): string {
  return text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

/** Embed a single text string → 1536-dim vector */
export async function getEmbedding(text: string): Promise<number[]> {
  const input = sanitize(text);
  if (!input) return new Array(1536).fill(0);

  try {
    const res = await getClient().embeddings.create({
      model: MODEL,
      input,
    });
    return res.data[0].embedding;
  } catch (err) {
    // One retry after 1s
    console.warn("Embedding failed, retrying in 1s:", err);
    await new Promise((r) => setTimeout(r, 1000));
    const res = await getClient().embeddings.create({
      model: MODEL,
      input,
    });
    return res.data[0].embedding;
  }
}

/** Embed multiple texts in a single batch → array of 1536-dim vectors */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const inputs = texts.map(sanitize).map((t) => t || " ");

  try {
    const res = await getClient().embeddings.create({
      model: MODEL,
      input: inputs,
    });
    // Sort by index to preserve order
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (err) {
    console.warn("Batch embedding failed, retrying in 1s:", err);
    await new Promise((r) => setTimeout(r, 1000));
    const res = await getClient().embeddings.create({
      model: MODEL,
      input: inputs,
    });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
