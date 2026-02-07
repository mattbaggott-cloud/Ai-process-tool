"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";

/* ── Types ─────────────────────────────────────────────── */

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;        /* mime type */
  addedAt: string;
  textContent: string | null;
  storagePath: string; /* path in Supabase Storage */
}

/* Chat files are session-only — stored in memory with the raw File */
export interface ChatFile {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: string;
  textContent: string | null;
  file: File;
}

interface FileContextValue {
  /* Library files — permanent, persisted to Supabase */
  libraryFiles: UploadedFile[];
  addLibraryFiles: (newFiles: File[]) => Promise<void>;
  removeLibraryFile: (id: string) => Promise<void>;
  libraryLoading: boolean;

  /* Chat files — session-only, in-memory only */
  chatFiles: ChatFile[];
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

/* ── Context ───────────────────────────────────────────── */

const FileContext = createContext<FileContextValue | null>(null);

export function useFiles(): FileContextValue {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error("useFiles must be used within FileProvider");
  return ctx;
}

/* ── Provider ──────────────────────────────────────────── */

export function FileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const supabase = createClient();

  /* Library files — persisted to Supabase Storage + library_files table */
  const [libraryFiles, setLibraryFiles] = useState<UploadedFile[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);

  /* Chat files — session-only, in-memory */
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([]);

  /* prevent rapid duplicate drops */
  const processingRef = useRef(false);

  /* ── Load library files from Supabase on login ── */
  useEffect(() => {
    if (!user) {
      setLibraryFiles([]);
      setLibraryLoading(false);
      return;
    }

    setLibraryLoading(true);
    supabase
      .from("library_files")
      .select("*")
      .order("added_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setLibraryFiles(
            data.map((row) => ({
              id: row.id,
              name: row.name,
              size: row.size,
              type: row.mime_type,
              addedAt: row.added_at,
              textContent: row.text_content,
              storagePath: row.storage_path,
            }))
          );
        }
        setLibraryLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ── Add library files (upload to Storage + insert metadata) ── */
  const addLibraryFiles = useCallback(
    async (newFiles: File[]) => {
      if (!user || processingRef.current) return;
      processingRef.current = true;

      try {
        const entries: UploadedFile[] = [];

        for (const file of newFiles) {
          if (file.size > MAX_FILE_SIZE) continue;

          /* Extract text for AI context */
          let textContent: string | null = null;
          if (isTextReadable(file)) {
            try {
              textContent = await readFileAsText(file);
            } catch {
              textContent = null;
            }
          }

          /* Upload file to Supabase Storage */
          const storagePath = `${user.id}/${Date.now()}-${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from("library-files")
            .upload(storagePath, file);

          if (uploadError) {
            console.error("Upload error:", uploadError.message);
            continue;
          }

          /* Insert metadata row */
          const { data: row, error: insertError } = await supabase
            .from("library_files")
            .insert({
              user_id: user.id,
              name: file.name,
              size: file.size,
              mime_type: file.type || "application/octet-stream",
              storage_path: storagePath,
              text_content: textContent,
            })
            .select()
            .single();

          if (insertError || !row) {
            console.error("Insert error:", insertError?.message);
            continue;
          }

          entries.push({
            id: row.id,
            name: row.name,
            size: row.size,
            type: row.mime_type,
            addedAt: row.added_at,
            textContent: row.text_content,
            storagePath: row.storage_path,
          });
        }

        if (entries.length > 0) {
          setLibraryFiles((prev) => [...entries, ...prev]);
        }
      } finally {
        processingRef.current = false;
      }
    },
    [user, supabase]
  );

  /* ── Remove library file (delete from Storage + table) ── */
  const removeLibraryFile = useCallback(
    async (id: string) => {
      if (!user) return;
      const file = libraryFiles.find((f) => f.id === id);
      if (!file) return;

      /* Remove from Storage */
      await supabase.storage
        .from("library-files")
        .remove([file.storagePath]);

      /* Remove metadata row */
      await supabase.from("library_files").delete().eq("id", id);

      /* Update local state */
      setLibraryFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [user, libraryFiles, supabase]
  );

  /* ── Chat files — session-only (no Supabase) ── */

  const addChatFiles = useCallback(async (newFiles: File[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const entries: ChatFile[] = [];
      for (const file of newFiles) {
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
          id: uid("chat"),
          name: file.name,
          size: file.size,
          type: file.type,
          addedAt: new Date().toISOString(),
          textContent,
          file,
        });
      }
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
        libraryFiles,
        addLibraryFiles,
        removeLibraryFile,
        libraryLoading,
        chatFiles,
        addChatFiles,
        removeChatFile,
        clearChatFiles,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}
