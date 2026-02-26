"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFiles, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import { useLayout } from "@/context/LayoutContext";
import { useOrg } from "@/context/OrgContext";
import { RichMessageContent, hasInlineBlocks } from "@/components/chat/ChatMessageRenderer";

/* ── Types ──────────────────────────────────────────────── */

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY_PREFIX = "sv-home-chat";

function getStorageKey(orgId: string | null) {
  return `${STORAGE_KEY_PREFIX}-${orgId || "default"}`;
}

function getConversationKey(orgId: string | null) {
  return `${STORAGE_KEY_PREFIX}-convId-${orgId || "default"}`;
}

/* ── Suggestion Chips ──────────────────────────────────── */

const SUGGESTIONS = [
  { label: "Show me my top customers", icon: "users" },
  { label: "How are campaigns performing?", icon: "chart" },
  { label: "Analyze revenue trends", icon: "trend" },
  { label: "Summarize my CRM pipeline", icon: "pipeline" },
  { label: "Find at-risk customers", icon: "alert" },
  { label: "What products are trending?", icon: "product" },
] as const;

/* ── Suggestion Icon SVGs ──────────────────────────────── */

function SuggestionIcon({ type }: { type: string }) {
  switch (type) {
    case "users":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "chart":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="18" y="3" width="4" height="18" rx="1" /><rect x="10" y="8" width="4" height="13" rx="1" /><rect x="2" y="13" width="4" height="8" rx="1" />
        </svg>
      );
    case "trend":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case "pipeline":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 8.5h4.5a2 2 0 0 1 2 2V14" />
        </svg>
      );
    case "alert":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "product":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
        </svg>
      );
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════
   HOME CHAT COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function HomeChat() {
  const { setHideRightPanel } = useLayout();
  const { orgId } = useOrg();
  const pathname = usePathname();

  /* ── Load persisted messages from localStorage ── */
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(getStorageKey(orgId));
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });

  /* ── Persisted conversationId for Data Agent session continuity ── */
  const [conversationId, setConversationId] = useState(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    try {
      const stored = localStorage.getItem(getConversationKey(orgId));
      if (stored) return stored;
    } catch { /* ignore */ }
    const id = crypto.randomUUID();
    try { localStorage.setItem(getConversationKey(orgId), id); } catch { /* ignore */ }
    return id;
  });

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string | null>(null);

  const { chatFiles, addChatFiles, removeChatFile, clearChatFiles } = useFiles();
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasHiddenWhileStreaming = useRef(false);

  /* ── Hide right panel on mount, restore on unmount ── */
  useEffect(() => {
    setHideRightPanel(true);
    return () => setHideRightPanel(false);
  }, [setHideRightPanel]);

  /* ── Auto-scroll on new messages ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Persist messages to localStorage whenever they change ── */
  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey(orgId), JSON.stringify(messages));
    } catch { /* quota or SSR */ }
  }, [messages, orgId]);

  /* ── Track tab visibility for streaming resilience ── */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && sending) {
        wasHiddenWhileStreaming.current = true;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sending]);

  /* ── New Chat ── */
  const handleNewChat = useCallback(() => {
    setMessages([]);
    const newId = crypto.randomUUID();
    setConversationId(newId);
    try {
      localStorage.setItem(getConversationKey(orgId), newId);
      localStorage.removeItem(getStorageKey(orgId));
    } catch { /* ignore */ }
  }, [orgId]);

  /* ── File upload handler ── */
  const handleChatFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        await addChatFiles(Array.from(e.target.files));
        e.target.value = "";
      }
    },
    [addChatFiles]
  );

  /* ── Clarification click ── */
  const handleClarificationSelect = useCallback((value: string) => {
    setInput(value);
    setTimeout(() => {
      const form = document.querySelector(".home-chat-input-area form") as HTMLFormElement;
      if (form) form.requestSubmit();
    }, 100);
  }, []);

  /* ── Submit message (streaming) ── */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || sending) return;

      const userMessage: Message = { role: "user", content: input.trim() };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setSending(true);

      const chatFileContents = chatFiles
        .filter((f) => f.textContent !== null)
        .map((f) => ({ name: f.name, content: f.textContent! }));

      const activeSegment = (window as unknown as Record<string, unknown>).__activeSegment ?? null;

      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 300_000);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortCtrl.signal,
          body: JSON.stringify({
            messages: updatedMessages,
            currentPage: pathname,
            chatFileContents,
            activeSegment,
            conversationId,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${errText}` },
          ]);
          setSending(false);
          return;
        }

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = decoder.decode(value, { stream: true });

          chunk = chunk.replace(/<!--HEARTBEAT-->/g, "");

          const progressRegex = /<!--PROGRESS:(.*?)-->/g;
          let progressMatch;
          while ((progressMatch = progressRegex.exec(chunk)) !== null) {
            setProgressStatus(progressMatch[1]);
          }
          chunk = chunk.replace(progressRegex, "");

          if (chunk) {
            if (chunk.trim()) setProgressStatus(null);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
              return updated;
            });
          }
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content.trim()) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: "No response was generated. Please try rephrasing your question.",
            };
            return updated;
          }
          return prev;
        });

        window.dispatchEvent(new Event("workspace-updated"));
        setTimeout(() => window.dispatchEvent(new Event("workspace-updated")), 500);
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        const wasHidden = wasHiddenWhileStreaming.current;
        setMessages([
          ...updatedMessages,
          {
            role: "assistant",
            content: isAbort
              ? "Request timed out. Try breaking your question into simpler parts."
              : wasHidden
                ? "The connection was interrupted while your screen was off. Try asking again."
                : "Sorry, something went wrong. Please try again.",
          },
        ]);
      } finally {
        clearTimeout(abortTimer);
        setSending(false);
        setProgressStatus(null);
        wasHiddenWhileStreaming.current = false;
      }
    },
    [input, messages, sending, chatFiles, pathname, conversationId]
  );

  /* ── Submit a suggestion chip ── */
  const handleSuggestion = useCallback(
    (text: string) => {
      if (sending) return;
      setInput(text);
      // Immediately submit
      const userMessage: Message = { role: "user", content: text };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setSending(true);
      setInput("");

      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 300_000);

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortCtrl.signal,
            body: JSON.stringify({
              messages: updatedMessages,
              currentPage: pathname,
              chatFileContents: [],
              activeSegment: null,
              conversationId,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: `Error: ${errText}` },
            ]);
            setSending(false);
            return;
          }

          setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            let chunk = decoder.decode(value, { stream: true });
            chunk = chunk.replace(/<!--HEARTBEAT-->/g, "");

            const progressRegex = /<!--PROGRESS:(.*?)-->/g;
            let progressMatch;
            while ((progressMatch = progressRegex.exec(chunk)) !== null) {
              setProgressStatus(progressMatch[1]);
            }
            chunk = chunk.replace(progressRegex, "");

            if (chunk) {
              if (chunk.trim()) setProgressStatus(null);
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + chunk,
                };
                return updated;
              });
            }
          }

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content.trim()) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: "No response was generated. Please try rephrasing your question.",
              };
              return updated;
            }
            return prev;
          });

          window.dispatchEvent(new Event("workspace-updated"));
          setTimeout(() => window.dispatchEvent(new Event("workspace-updated")), 500);
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          setMessages([
            ...updatedMessages,
            {
              role: "assistant",
              content: isAbort
                ? "Request timed out. Try breaking your question into simpler parts."
                : "Sorry, something went wrong. Please try again.",
            },
          ]);
        } finally {
          clearTimeout(abortTimer);
          setSending(false);
          setProgressStatus(null);
        }
      })();
    },
    [sending, messages, pathname, conversationId]
  );

  /* ── Determine if we're in "welcome" state ── */
  const hasUserMessages = messages.some((m) => m.role === "user");

  return (
    <div className="home-chat">
      {/* ─── Header ─── */}
      <div className="home-chat-header">
        <button
          className="home-chat-new-btn"
          onClick={handleNewChat}
          disabled={sending}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 1v12M1 7h12" />
          </svg>
          New Chat
        </button>
      </div>

      {/* ─── Messages Area ─── */}
      <div className="home-chat-messages">
        {!hasUserMessages ? (
          /* ── Welcome State ── */
          <div className="home-chat-welcome">
            <div className="home-chat-welcome-avatar">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
                <path d="M14 2L22 10L14 18L6 10Z" opacity="0.85" />
                <path d="M4 16v3a8 8 0 008 8h4a8 8 0 008-8v-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className="home-chat-welcome-title">How can I help you today?</h1>
            <p className="home-chat-welcome-subtitle">
              Ask anything about your customers, campaigns, revenue, or business operations.
            </p>
            <div className="home-chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  className="home-chat-suggestion"
                  onClick={() => handleSuggestion(s.label)}
                  disabled={sending}
                >
                  <span className="home-chat-suggestion-icon">
                    <SuggestionIcon type={s.icon} />
                  </span>
                  <span className="home-chat-suggestion-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Conversation ── */
          <div className="home-chat-conversation">
            {messages.map((msg, i) => (
              <div key={i} className={`home-chat-msg ${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="ai-msg-sender">
                    <div className="ai-avatar">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                        <path d="M5 1 L9 5 L5 9 L1 5 Z" />
                      </svg>
                    </div>
                    <span>AI Copilot</span>
                  </div>
                )}
                {msg.role === "assistant" && msg.content === "" && sending ? (
                  <div className="ai-progress-indicator">
                    <div className="ai-progress-sparkle" />
                    <span className="ai-progress-text" key={progressStatus}>
                      {progressStatus || "Thinking..."}
                    </span>
                  </div>
                ) : msg.role === "assistant" && hasInlineBlocks(msg.content) ? (
                  <RichMessageContent
                    content={msg.content}
                    onClarificationSelect={handleClarificationSelect}
                  />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ─── Input Area ─── */}
      <div className="home-chat-input-area">
        <div className="home-chat-input-container">
          <input
            ref={chatFileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={handleChatFileInput}
            style={{ display: "none" }}
          />
          <button
            className="ai-upload-btn"
            type="button"
            onClick={() => chatFileInputRef.current?.click()}
            disabled={sending}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 1v10M1 6h10" />
            </svg>
            Attach files
          </button>

          {chatFiles.length > 0 && (
            <div className="ai-file-chips">
              {chatFiles.map((f) => (
                <span key={f.id} className="ai-file-chip">
                  <span className="ai-file-chip-name">{f.name}</span>
                  <button
                    className="ai-file-chip-remove"
                    onClick={() => removeChatFile(f.id)}
                    title="Remove"
                  >
                    &times;
                  </button>
                </span>
              ))}
              <button
                className="ai-file-chip-clear"
                onClick={clearChatFiles}
                title="Clear all"
              >
                Clear all
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="home-chat-form">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={sending ? "Waiting for response..." : "Ask me anything..."}
              rows={1}
              className="ai-textarea"
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !sending) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              className="ai-send-btn"
              aria-label="Send message"
              disabled={sending || !input.trim()}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8h12M9 3l5 5-5 5" />
              </svg>
            </button>
          </form>
        </div>
        <div className="home-chat-footer">
          AI Copilot may produce inaccurate results. Verify important data.
        </div>
      </div>
    </div>
  );
}
