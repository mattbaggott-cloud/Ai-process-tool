/**
 * Text chunking for RAG embedding pipeline
 * Splits documents into chunks optimized for semantic search
 */

export interface Chunk {
  text: string;
  index: number;
  metadata: Record<string, unknown>;
}

/** Split text into overlapping chunks */
export function chunkText(
  text: string,
  options?: { maxChunkSize?: number; overlap?: number }
): string[] {
  const maxSize = options?.maxChunkSize ?? 1000;
  const overlap = options?.overlap ?? 200;

  if (!text || text.length <= maxSize) return text ? [text] : [];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxSize, text.length);

    // Try to break at a sentence boundary (. ! ? \n)
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n\n")
      );
      if (lastBreak > maxSize * 0.3) {
        end = start + lastBreak + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 10); // Skip tiny fragments
}

/** Build chunks with metadata for a specific source record */
export function chunkDocument(
  sourceTable: string,
  sourceId: string,
  record: Record<string, unknown>
): Chunk[] {
  switch (sourceTable) {
    case "goals":
      return chunkGoal(sourceId, record);
    case "sub_goals":
      return chunkSubGoal(sourceId, record);
    case "pain_points":
      return chunkPainPoint(sourceId, record);
    case "library_items":
      return chunkLibraryItem(sourceId, record);
    case "library_files":
    case "organization_files":
    case "team_files":
      return chunkFile(sourceTable, sourceId, record);
    default:
      return chunkGeneric(sourceId, record);
  }
}

/* ── Source-specific chunkers ── */

function chunkGoal(id: string, r: Record<string, unknown>): Chunk[] {
  const text = [r.name, r.description].filter(Boolean).join(": ");
  if (!text) return [];
  return [{
    text,
    index: 0,
    metadata: {
      title: r.name,
      type: "goal",
      status: r.status,
      owner: r.owner,
      teams: r.teams,
      metric: r.metric,
      metric_target: r.metric_target,
      start_date: r.start_date,
      end_date: r.end_date,
    },
  }];
}

function chunkSubGoal(id: string, r: Record<string, unknown>): Chunk[] {
  const text = [r.name, r.description].filter(Boolean).join(": ");
  if (!text) return [];
  return [{
    text,
    index: 0,
    metadata: {
      title: r.name,
      type: "sub_goal",
      status: r.status,
      owner: r.owner,
      goal_id: r.goal_id,
    },
  }];
}

function chunkPainPoint(id: string, r: Record<string, unknown>): Chunk[] {
  const text = [r.name, r.description].filter(Boolean).join(": ");
  if (!text) return [];
  return [{
    text,
    index: 0,
    metadata: {
      title: r.name,
      type: "pain_point",
      severity: r.severity,
      status: r.status,
      owner: r.owner,
      teams: r.teams,
      impact_metric: r.impact_metric,
      linked_goal_id: r.linked_goal_id,
    },
  }];
}

function chunkLibraryItem(id: string, r: Record<string, unknown>): Chunk[] {
  const content = String(r.content ?? "");
  const title = String(r.title ?? "");
  const fullText = title ? `${title}\n\n${content}` : content;
  if (!fullText.trim()) return [];

  const texts = chunkText(fullText, { maxChunkSize: 1000, overlap: 200 });
  return texts.map((text, index) => ({
    text,
    index,
    metadata: {
      title,
      type: "library_item",
      category: r.category,
      tags: r.tags,
    },
  }));
}

function chunkFile(
  sourceTable: string,
  id: string,
  r: Record<string, unknown>
): Chunk[] {
  const content = String(r.text_content ?? "");
  const name = String(r.name ?? "");
  if (!content.trim()) return [];

  const texts = chunkText(content, { maxChunkSize: 1000, overlap: 200 });
  return texts.map((text, index) => ({
    text,
    index,
    metadata: {
      title: name,
      type: sourceTable,
      mime_type: r.mime_type,
      team_id: r.team_id,
    },
  }));
}

function chunkGeneric(id: string, r: Record<string, unknown>): Chunk[] {
  const text = String(r.content ?? r.text_content ?? r.description ?? "");
  if (!text.trim()) return [];

  const texts = chunkText(text, { maxChunkSize: 1000, overlap: 200 });
  return texts.map((t, index) => ({
    text: t,
    index,
    metadata: { title: r.name || r.title || "" },
  }));
}
