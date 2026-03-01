"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFiles, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import { useLayout } from "@/context/LayoutContext";
import { RichMessageContent, hasInlineBlocks } from "@/components/chat/ChatMessageRenderer";
import { useSlashMenu } from "@/hooks/useSlashMenu";
import ChatSlashMenu from "@/components/chat/ChatSlashMenu";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/* ── Main Chat Component ─────────────────────────────────── */

export default function AIChat() {
  const { toggleChat } = useLayout();
  const [conversationId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI copilot. I can help you model your business processes, identify automation opportunities, and compare tools. What would you like to explore?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string | null>(null);
  const pathname = usePathname();

  /* Chat files are session-only — gone when conversation ends */
  const { chatFiles, addChatFiles, removeChatFile, clearChatFiles } = useFiles();
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasHiddenWhileStreaming = useRef(false);
  const lastRequestBody = useRef<string | null>(null);
  const streamedContentRef = useRef("");

  /* Auto-scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* Track tab visibility — if the tab goes hidden while streaming,
     the browser may suspend JS and buffer network data.  The backend
     heartbeat keeps the TCP connection alive, but if the device fully
     sleeps (laptop lid closed), the connection can still drop.
     Mark this so the catch block can show a better error message. */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && sending) {
        wasHiddenWhileStreaming.current = true;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sending]);

  const handleChatFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addChatFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  }, [addChatFiles]);

  /* ── Slash Command Menu ── */
  const formRef = useRef<HTMLFormElement>(null);
  const slashMenu = useSlashMenu({
    onSelect: (cmd) => {
      setInput(cmd.command);
      setTimeout(() => {
        if (formRef.current) formRef.current.requestSubmit();
      }, 50);
    },
  });

  // When a user clicks a clarification option, send it as a chat message
  const handleClarificationSelect = useCallback((value: string) => {
    setInput(value);
    // Auto-submit after a brief delay so user sees what's being sent
    setTimeout(() => {
      const form = document.querySelector(".ai-input-area form") as HTMLFormElement;
      if (form) form.requestSubmit();
    }, 100);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || sending) return;

      const userMessage: Message = { role: "user", content: input.trim() };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setSending(true);

      /* Prepare chat file contents for the API */
      const chatFileContents = chatFiles
        .filter((f) => f.textContent !== null)
        .map((f) => ({ name: f.name, content: f.textContent! }));

      // Read active segment context if on segments page
      const activeSegment = (window as unknown as Record<string, unknown>).__activeSegment ?? null;

      /* Abort controller — 5 min max per request (complex multi-tool queries need time) */
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 300_000);

      const requestBody = JSON.stringify({
        messages: updatedMessages,
        currentPage: pathname,
        chatFileContents,
        activeSegment,
        conversationId,
      });
      lastRequestBody.current = requestBody;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortCtrl.signal,
          body: requestBody,
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

        /* Add empty assistant message that we'll stream into */
        streamedContentRef.current = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = decoder.decode(value, { stream: true });

          // Strip heartbeat keep-alive markers (backend sends these to prevent TCP timeout)
          chunk = chunk.replace(/<!--HEARTBEAT-->/g, "");

          // Extract progress markers — show as animated status, strip from content
          const progressRegex = /<!--PROGRESS:(.*?)-->/g;
          let progressMatch;
          while ((progressMatch = progressRegex.exec(chunk)) !== null) {
            setProgressStatus(progressMatch[1]);
          }
          // Strip all progress markers from the chunk
          chunk = chunk.replace(progressRegex, "");

          // Only update message if there's actual content after stripping
          if (chunk) {
            // Once real content arrives, clear progress status
            if (chunk.trim()) setProgressStatus(null);
            // Use ref as single source of truth to prevent React batching duplicates
            streamedContentRef.current += chunk;
            const snapshot = streamedContentRef.current;
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { ...updated[lastIdx], content: snapshot };
              }
              return updated;
            });
          }
        }

        /* If streaming completed but produced no content, replace with error */
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

        /* Notify other components to refresh their data */
        window.dispatchEvent(new Event("workspace-updated"));
        /* Dispatch again after a short delay to catch any DB propagation lag */
        setTimeout(() => window.dispatchEvent(new Event("workspace-updated")), 500);
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        const wasHidden = wasHiddenWhileStreaming.current;
        // Use updatedMessages (pre-stream snapshot) to avoid keeping the empty
        // assistant placeholder that was added when streaming began.
        setMessages([
          ...updatedMessages,
          {
            role: "assistant",
            content: isAbort
              ? "Request timed out — this question may require too many steps. Try breaking it into simpler parts."
              : wasHidden
                ? "The connection was interrupted while your screen was off. Your request may still have been processed — try asking the same question again."
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
    [input, messages, sending, chatFiles, pathname]
  );

  return (
    <aside className="ai-panel">
      {/* --- Header --- */}
      <div className="ai-panel-header">
        <span className="ai-panel-header-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 0.5L10.5 4.5L7 8.5L3.5 4.5Z" opacity="0.85" />
            <path d="M2 8v1.5a4 4 0 004 4h2a4 4 0 004-4V8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <span className="ai-panel-title">AI Copilot</span>
        <span className="ai-panel-header-spacer" />
        <button
          className="ai-panel-close-btn"
          onClick={toggleChat}
          title="Close AI Copilot"
          aria-label="Close AI Copilot"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 3l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* --- Messages --- */}
      <div className="ai-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ${msg.role}`}>
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
            {/* Show animated progress status while waiting for content */}
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

      {/* --- Input --- */}
      <div className="ai-input-area">

        {/* -- Add files for this session -- */}
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
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 1v12M1 7h12" />
          </svg>
          Add files for this session
        </button>

        {/* -- Session file chips -- */}
        {chatFiles.length > 0 && (
          <div className="ai-file-chips">
            {chatFiles.map((f) => (
              <span key={f.id} className="ai-file-chip">
                <span className="ai-file-chip-name">{f.name}</span>
                <button
                  className="ai-file-chip-remove"
                  onClick={() => removeChatFile(f.id)}
                  title="Remove from session"
                >
                  &times;
                </button>
              </span>
            ))}
            <button
              className="ai-file-chip-clear"
              onClick={clearChatFiles}
              title="Clear all session files"
            >
              Clear all
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="ai-form" ref={formRef}>
          {slashMenu.isOpen && (
            <ChatSlashMenu
              commands={slashMenu.filteredCommands}
              activeIndex={slashMenu.activeIndex}
              onSelect={slashMenu.selectCommand}
              onHover={slashMenu.setActiveIndex}
              onClose={slashMenu.close}
            />
          )}
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              slashMenu.handleInputChange(e.target.value);
            }}
            placeholder={sending ? "Waiting for response..." : "Type your message... (type / for commands)"}
            rows={3}
            className="ai-textarea"
            disabled={sending}
            onKeyDown={(e) => {
              slashMenu.handleKeyDown(e);
              if (!slashMenu.isOpen && e.key === "Enter" && !e.shiftKey && !sending) {
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
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 7h12M8 2l5 5-5 5" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
