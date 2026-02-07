"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFiles, ACCEPTED_EXTENSIONS } from "@/context/FileContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI copilot. I can help you model your business processes, identify automation opportunities, and compare tools. What would you like to explore?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const pathname = usePathname();

  /* Chat files are session-only — gone when conversation ends */
  const { chatFiles, addChatFiles, removeChatFile, clearChatFiles } = useFiles();
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleChatFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addChatFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  }, [addChatFiles]);

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

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages,
            currentPage: pathname,
            chatFileContents,
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

        /* Add empty assistant message that we'll stream into */
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
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
        /* Notify other components to refresh their data */
        window.dispatchEvent(new Event("workspace-updated"));
        /* Dispatch again after a short delay to catch any DB propagation lag */
        setTimeout(() => window.dispatchEvent(new Event("workspace-updated")), 500);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [input, messages, sending, chatFiles, pathname]
  );

  return (
    <aside className="ai-panel">
      {/* ─── Header ─── */}
      <div className="ai-panel-header">
        <h2 className="ai-panel-title">AI Copilot</h2>
        <p className="ai-panel-subtitle">Context-aware assistant</p>
      </div>

      {/* ─── Messages ─── */}
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
            {/* Show pulsing dots while streaming hasn't started yet */}
            {msg.role === "assistant" && msg.content === "" && sending ? (
              <p className="ai-typing">Thinking...</p>
            ) : (
              <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ─── Input ─── */}
      <div className="ai-input-area">

        {/* ── Add files for this session ── */}
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

        {/* ── Session file chips ── */}
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

        <form onSubmit={handleSubmit} className="ai-form">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={sending ? "Waiting for response..." : "Type your message..."}
            rows={3}
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
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 7h12M8 2l5 5-5 5" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
