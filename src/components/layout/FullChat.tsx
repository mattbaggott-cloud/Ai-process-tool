"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFiles, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import { useLayout } from "@/context/LayoutContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function FullChat() {
  const { setHideRightPanel } = useLayout();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI copilot in full chat mode. I have full context of your workspace — ask me anything about your business, tools, teams, or projects.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const pathname = usePathname();

  const { chatFiles, addChatFiles, removeChatFile, clearChatFiles } = useFiles();
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Hide the right AI panel on mount, restore on unmount */
  useEffect(() => {
    setHideRightPanel(true);
    return () => setHideRightPanel(false);
  }, [setHideRightPanel]);

  /* Auto-scroll to bottom */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleChatFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        await addChatFiles(Array.from(e.target.files));
        e.target.value = "";
      }
    },
    [addChatFiles]
  );

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

        window.dispatchEvent(new Event("workspace-updated"));
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
    <div className="full-chat">
      {/* Messages */}
      <div className="full-chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`full-chat-msg ${msg.role}`}>
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
              <p className="ai-typing">Thinking...</p>
            ) : (
              <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="full-chat-input-area">
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

        <form onSubmit={handleSubmit} className="ai-form" style={{ maxWidth: 800, margin: "0 auto", width: "100%" }}>
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
    </div>
  );
}
