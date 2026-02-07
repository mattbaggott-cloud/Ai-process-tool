"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";

/* ── Types ─────────────────────────────────────────────── */

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: string;
  textContent: string | null;
  file: File;
}

interface FileContextValue {
  /* Library files — permanent platform storage, AI always has context */
  libraryFiles: UploadedFile[];
  addLibraryFiles: (newFiles: File[]) => Promise<void>;
  removeLibraryFile: (id: string) => void;

  /* Chat files — session-only, gone when conversation ends */
  chatFiles: UploadedFile[];
  addChatFiles: (newFiles: File[]) => Promise<void>;
  removeChatFile: (id: string) => void;
  clearChatFiles: () => void;
}

/* ── Helpers ───────────────────────────────────────────── */

let counter = 0;
const uid = (prefix: string) => `${prefix}-${++counter}-${Date.now()}`;

const TEXT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/json",
]);

const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "json", "tsv"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ACCEPTED_EXTENSIONS = ["pdf", "csv", "txt", "md", "json", "tsv"];

function isTextReadable(file: File): boolean {
  if (TEXT_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function readFileAsText(file: File): Promise<string> {
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

export function getFileExtension(name: string): string {
  return (name.split(".").pop() ?? "").toUpperCase();
}

/* shared logic for processing files */
async function processFiles(rawFiles: File[]): Promise<UploadedFile[]> {
  const entries: UploadedFile[] = [];

  for (const file of rawFiles) {
    if (file.size > MAX_FILE_SIZE) continue;

    let textContent: string | null = null;
    if (isTextReadable(file)) {
      try {
        textContent = await readFileAsText(file);
      } catch {
        textContent = null;
      }
    }

    entries.push({
      id: uid("file"),
      name: file.name,
      size: file.size,
      type: file.type,
      addedAt: new Date().toISOString(),
      textContent,
      file,
    });
  }

  return entries;
}

/* ── Context ───────────────────────────────────────────── */

const FileContext = createContext<FileContextValue | null>(null);

export function useFiles(): FileContextValue {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error("useFiles must be used within FileProvider");
  return ctx;
}

/* ── Provider ──────────────────────────────────────────── */

export function FileProvider({ children }: { children: ReactNode }) {
  /* Library files — permanent platform storage */
  const [libraryFiles, setLibraryFiles] = useState<UploadedFile[]>([]);

  /* Chat files — session-only, temporary context for current conversation */
  const [chatFiles, setChatFiles] = useState<UploadedFile[]>([]);

  /* prevent rapid duplicate drops */
  const processingRef = useRef(false);

  const addLibraryFiles = useCallback(async (newFiles: File[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const entries = await processFiles(newFiles);
      if (entries.length > 0) setLibraryFiles((prev) => [...entries, ...prev]);
    } finally {
      processingRef.current = false;
    }
  }, []);

  const removeLibraryFile = useCallback((id: string) => {
    setLibraryFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const addChatFiles = useCallback(async (newFiles: File[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const entries = await processFiles(newFiles);
      if (entries.length > 0) setChatFiles((prev) => [...entries, ...prev]);
    } finally {
      processingRef.current = false;
    }
  }, []);

  const removeChatFile = useCallback((id: string) => {
    setChatFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearChatFiles = useCallback(() => {
    setChatFiles([]);
  }, []);

  return (
    <FileContext.Provider
      value={{
        libraryFiles, addLibraryFiles, removeLibraryFile,
        chatFiles, addChatFiles, removeChatFile, clearChatFiles,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}
