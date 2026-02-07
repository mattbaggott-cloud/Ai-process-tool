/* ── Shared file upload helpers ─────────────────────────── */

export const ACCEPTED_EXTENSIONS = ["pdf", "csv", "txt", "md", "json", "tsv"];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const TEXT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/json",
]);
const TEXT_EXTS = new Set(["txt", "csv", "md", "json", "tsv"]);

export function isTextReadable(file: File): boolean {
  if (TEXT_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTS.has(ext);
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExt(name: string): string {
  return (name.split(".").pop() ?? "").toUpperCase();
}

export function fmtFileDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
