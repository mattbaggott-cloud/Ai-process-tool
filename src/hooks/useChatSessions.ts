"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Types ──────────────────────────────────────────────── */

interface Message {
  role: "user" | "assistant";
  content: string;
}

export type SessionType = "regular" | "onboarding";

export interface ChatSession {
  id: string;
  title: string;
  conversation_id: string;
  is_pinned: boolean;
  session_type: SessionType;
  created_at: string;
  updated_at: string;
  messages: Message[];
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  is_pinned: boolean;
  session_type: SessionType;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/* ── Date grouping helpers ──────────────────────────────── */

type DateGroup = "Today" | "Yesterday" | "Previous 7 days" | "Older";

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "Previous 7 days";
  return "Older";
}

export function groupSessionsByDate(
  sessions: ChatSessionMeta[]
): { group: DateGroup; sessions: ChatSessionMeta[] }[] {
  const groups: Record<DateGroup, ChatSessionMeta[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  // Pinned first, then by date
  const pinned = sessions.filter((s) => s.is_pinned);
  const unpinned = sessions.filter((s) => !s.is_pinned);

  for (const s of unpinned) {
    groups[getDateGroup(s.updated_at)].push(s);
  }

  const result: { group: DateGroup; sessions: ChatSessionMeta[] }[] = [];

  if (pinned.length > 0) {
    result.push({ group: "Today", sessions: [...pinned, ...groups.Today] });
  } else if (groups.Today.length > 0) {
    result.push({ group: "Today", sessions: groups.Today });
  }

  if (groups.Yesterday.length > 0) {
    result.push({ group: "Yesterday", sessions: groups.Yesterday });
  }
  if (groups["Previous 7 days"].length > 0) {
    result.push({ group: "Previous 7 days", sessions: groups["Previous 7 days"] });
  }
  if (groups.Older.length > 0) {
    result.push({ group: "Older", sessions: groups.Older });
  }

  return result;
}

/* ── Auto-title generation ─────────────────────────────── */

function generateTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New conversation";
  // Use first 60 chars of the user's first message
  const text = firstUser.content.replace(/\n/g, " ").trim();
  if (text.length <= 60) return text;
  return text.slice(0, 57) + "...";
}

/* ── Hook ───────────────────────────────────────────────── */

const SAVE_DEBOUNCE_MS = 2000;
const MAX_SESSIONS = 50;

export function useChatSessions(orgId: string | null, userId: string | null) {
  const supabase = createClient();

  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  /* ── Load session list on mount ── */
  const loadSessions = useCallback(async () => {
    if (!userId || !orgId) return;

    const { data } = await supabase
      .from("chat_sessions")
      .select("id, title, is_pinned, session_type, created_at, updated_at, messages")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(MAX_SESSIONS);

    if (data) {
      setSessions(
        data.map((s) => ({
          id: s.id,
          title: s.title,
          is_pinned: s.is_pinned,
          session_type: (s.session_type as SessionType) || "regular",
          created_at: s.created_at,
          updated_at: s.updated_at,
          message_count: Array.isArray(s.messages) ? (s.messages as unknown[]).length : 0,
        }))
      );
    }

    setLoading(false);
  }, [userId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /* ── Create a new session ── */
  const createSession = useCallback(async (
    sessionType: SessionType = "regular"
  ): Promise<string | null> => {
    if (!userId || !orgId) return null;

    const title = sessionType === "onboarding" ? "Welcome to SocialVerve" : "New conversation";

    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        org_id: orgId,
        user_id: userId,
        title,
        messages: [],
        session_type: sessionType,
      })
      .select("id, title, is_pinned, session_type, created_at, updated_at, conversation_id")
      .single();

    if (error || !data) return null;

    const meta: ChatSessionMeta = {
      id: data.id,
      title: data.title,
      is_pinned: data.is_pinned,
      session_type: (data.session_type as SessionType) || "regular",
      created_at: data.created_at,
      updated_at: data.updated_at,
      message_count: 0,
    };

    setSessions((prev) => [meta, ...prev]);
    setActiveSessionId(data.id);
    setActiveMessages([]);
    setConversationId(data.conversation_id);
    lastSavedRef.current = "[]";

    return data.id;
  }, [userId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load a specific session ── */
  const loadSession = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title, conversation_id, messages")
      .eq("id", sessionId)
      .single();

    if (error || !data) return;

    const msgs = (data.messages as unknown as Message[]) ?? [];
    setActiveSessionId(data.id);
    setActiveMessages(msgs);
    setConversationId(data.conversation_id);
    lastSavedRef.current = JSON.stringify(msgs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Save messages (debounced) ── */
  const saveMessages = useCallback(
    (messages: Message[]) => {
      setActiveMessages(messages);

      // Immediately update sidebar title (optimistic — don't wait for debounce)
      const title = generateTitle(messages);
      if (activeSessionId) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, title, message_count: messages.length }
              : s
          )
        );
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(async () => {
        if (!activeSessionId) return;

        const serialized = JSON.stringify(messages);
        if (serialized === lastSavedRef.current) return;
        lastSavedRef.current = serialized;

        await supabase
          .from("chat_sessions")
          .update({
            messages,
            title,
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeSessionId);

        // Sync updated_at after DB write
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, updated_at: new Date().toISOString() }
              : s
          )
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [activeSessionId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Delete a session ── */
  const deleteSession = useCallback(
    async (sessionId: string) => {
      const { error } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("id", sessionId);

      if (error) {
        console.error("Failed to delete session:", error.message);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

      // If we deleted the active session, clear it so HomeChat auto-creates a new one
      if (sessionId === activeSessionId) {
        setActiveSessionId(null);
        setActiveMessages([]);
        setConversationId("");
      }
    },
    [activeSessionId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Rename a session ── */
  const renameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      await supabase
        .from("chat_sessions")
        .update({ title: newTitle })
        .eq("id", sessionId);

      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Pin/unpin a session ── */
  const togglePin = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const newPinned = !session.is_pinned;

      await supabase
        .from("chat_sessions")
        .update({ is_pinned: newPinned })
        .eq("id", sessionId);

      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, is_pinned: newPinned } : s))
      );
    },
    [sessions] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    sessions,
    activeSessionId,
    activeMessages,
    conversationId,
    loading,
    createSession,
    loadSession,
    saveMessages,
    deleteSession,
    renameSession,
    togglePin,
    setActiveMessages,
    groupedSessions: groupSessionsByDate(sessions),
  };
}
