"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import {
  useChatSessions,
  type ChatSessionMeta,
  type SessionType,
} from "@/hooks/useChatSessions";

/* ── Context shape ──────────────────────────────────────── */

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSessionContextValue {
  sessions: ChatSessionMeta[];
  groupedSessions: { group: string; sessions: ChatSessionMeta[] }[];
  activeSessionId: string | null;
  activeMessages: Message[];
  conversationId: string;
  loading: boolean;
  onboardingCompleted: boolean;
  activeSessionType: SessionType;
  createSession: (sessionType?: SessionType) => Promise<string | null>;
  loadSession: (id: string) => Promise<void>;
  saveMessages: (messages: Message[]) => void;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setActiveMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

const ChatSessionCtx = createContext<ChatSessionContextValue | null>(null);

/* ── Provider ───────────────────────────────────────────── */

export function ChatSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { orgId, orgMembership } = useOrg();

  const hook = useChatSessions(orgId, user?.id ?? null);
  const onboardingCompleted = orgMembership?.onboarding_completed ?? false;

  // Determine the session type of the active session
  const activeSession = hook.sessions.find((s) => s.id === hook.activeSessionId);
  const activeSessionType: SessionType = activeSession?.session_type ?? "regular";

  // Auto-create onboarding session for new users
  const hasTriedOnboarding = useRef(false);
  useEffect(() => {
    if (
      !hook.loading &&
      user &&
      orgId &&
      !onboardingCompleted &&
      hook.sessions.length === 0 &&
      !hasTriedOnboarding.current
    ) {
      hasTriedOnboarding.current = true;
      hook.createSession("onboarding");
    }
  }, [hook.loading, user, orgId, onboardingCompleted, hook.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ChatSessionCtx.Provider
      value={{
        ...hook,
        onboardingCompleted,
        activeSessionType,
      }}
    >
      {children}
    </ChatSessionCtx.Provider>
  );
}

/* ── Consumer hook ──────────────────────────────────────── */

export function useChatSessionContext() {
  const ctx = useContext(ChatSessionCtx);
  if (!ctx) {
    throw new Error("useChatSessionContext must be used within ChatSessionProvider");
  }
  return ctx;
}
