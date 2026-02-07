"use client";

import { useState, useRef, useCallback } from "react";
import { useFiles, formatFileSize, getFileExtension, ACCEPTED_EXTENSIONS } from "@/context/FileContext";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIChat() {
  const [messages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI copilot. I can help you model your business processes, identify automation opportunities, and compare tools. What would you like to explore?",
    },
  ]);
  const [input, setInput] = useState("");

  /* Chat files are session-only — gone when conversation ends */
  const { chatFiles, addChatFiles, removeChatFile, clearChatFiles } = useFiles();
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const handleChatFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addChatFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  }, [addChatFiles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    // Will be wired to Claude API in Phase 2
    // AI always has context of all library files
    // chatFiles are additional session-only context for this conversation
    setInput("");
  };

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
            <p>{msg.content}</p>
          </div>
        ))}
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
            placeholder="Type your message..."
            rows={3}
            className="ai-textarea"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button type="submit" className="ai-send-btn" aria-label="Send message">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 7h12M8 2l5 5-5 5" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
