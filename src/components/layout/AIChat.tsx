"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useFiles, ACCEPTED_EXTENSIONS } from "@/context/FileContext";
import { useLayout } from "@/context/LayoutContext";
import dynamic from "next/dynamic";

/* Lazy-load ChartRenderer (uses Recharts which is heavy) */
const ChartRenderer = dynamic(
  () => import("@/components/canvas/blocks/ChartRenderer"),
  { ssr: false, loading: () => <div className="ai-inline-loading">Loading chart...</div> }
);

interface Message {
  role: "user" | "assistant";
  content: string;
}

/* ── Inline block types ─────────────────────────────────── */

interface InlineTableData {
  title?: string;
  headers: string[];
  rows: string[][];
  footer?: string;
}

interface InlineChartData {
  chart_type: "bar" | "line" | "pie" | "area";
  title?: string;
  data: Record<string, unknown>[];
  x_key: string;
  y_keys: string[];
  colors?: string[];
}

interface InlineProfileData {
  title: string;
  sections: Array<{
    title: string;
    fields: Array<{
      label: string;
      value: string;
      confidence: "verified" | "ai_inferred" | "computed";
    }>;
  }>;
}

interface InlineMetricData {
  title: string;
  cards: Array<{
    label: string;
    value: string;
    change?: string;
    confidence: "verified" | "ai_inferred" | "computed";
  }>;
}

interface ClarificationData {
  question: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
  allow_freeform: boolean;
  reason: string;
}

interface ConfidenceData {
  inferred_fields: string[];
  total_fields: number;
}

type ContentSegment =
  | { type: "text"; content: string }
  | { type: "table"; data: InlineTableData }
  | { type: "chart"; data: InlineChartData }
  | { type: "profile"; data: InlineProfileData }
  | { type: "metric"; data: InlineMetricData }
  | { type: "clarification"; data: ClarificationData }
  | { type: "confidence"; data: ConfidenceData };

/* ── Parse message content for inline blocks ────────────── */

const INLINE_PATTERN = /<!--(?:INLINE_(TABLE|CHART|PROFILE|METRIC)|(CLARIFICATION)|(CONFIDENCE)):([\s\S]*?)-->/g;

function parseMessageContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(INLINE_PATTERN)) {
    const matchStart = match.index!;
    // Add text before this match
    if (matchStart > lastIndex) {
      const text = content.slice(lastIndex, matchStart).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    // match[1] = INLINE_ type (TABLE|CHART|PROFILE|METRIC)
    // match[2] = CLARIFICATION
    // match[3] = CONFIDENCE
    // match[4] = JSON payload
    const inlineType = match[1];
    const isClarification = match[2];
    const isConfidence = match[3];
    const jsonStr = match[4];

    try {
      const parsed = JSON.parse(jsonStr);
      if (inlineType === "TABLE" && parsed.headers && parsed.rows) {
        segments.push({ type: "table", data: parsed as InlineTableData });
      } else if (inlineType === "CHART" && parsed.data && parsed.x_key && parsed.y_keys) {
        segments.push({ type: "chart", data: parsed as InlineChartData });
      } else if (inlineType === "PROFILE" && parsed.sections) {
        segments.push({ type: "profile", data: parsed as InlineProfileData });
      } else if (inlineType === "METRIC" && parsed.cards) {
        segments.push({ type: "metric", data: parsed as InlineMetricData });
      } else if (isClarification && parsed.options) {
        segments.push({ type: "clarification", data: parsed as ClarificationData });
      } else if (isConfidence && parsed.inferred_fields) {
        segments.push({ type: "confidence", data: parsed as ConfidenceData });
      } else {
        // Malformed inline block — skip silently
        segments.push({ type: "text", content: "" });
      }
    } catch {
      // If JSON parsing fails, render as text
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = matchStart + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", content: text });
  }

  // If no matches found, return the whole content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

/* ── Inline Table Component ──────────────────────────────── */

function InlineTable({ data }: { data: InlineTableData }) {
  if (!data.headers || !data.rows) {
    return <p style={{ whiteSpace: "pre-wrap", color: "#888" }}>Table data unavailable</p>;
  }
  return (
    <div className="ai-inline-table">
      {data.title && <div className="ai-inline-table-title">{data.title}</div>}
      <div className="ai-inline-table-scroll">
        <table>
          <thead>
            <tr>
              {data.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.footer && <div className="ai-inline-table-footer">{data.footer}</div>}
    </div>
  );
}

/* ── Inline Chart Component ──────────────────────────────── */

function InlineChart({ data }: { data: InlineChartData }) {
  return (
    <div className="ai-inline-chart">
      {data.title && <div className="ai-inline-chart-title">{data.title}</div>}
      <ChartRenderer
        chartType={data.chart_type}
        chartData={data.data}
        chartConfig={{
          title: data.title,
          xKey: data.x_key,
          yKeys: data.y_keys,
          colors: data.colors,
        }}
      />
    </div>
  );
}

/* ── Inline Profile Component ──────────────────────────────── */

function InlineProfile({ data }: { data: InlineProfileData }) {
  return (
    <div className="ai-inline-profile">
      <div className="ai-inline-profile-title">{data.title}</div>
      {data.sections.map((section, sIdx) => (
        <div key={sIdx} className="ai-inline-profile-section">
          <div className="ai-inline-profile-section-title">{section.title}</div>
          <div className="ai-inline-profile-fields">
            {section.fields.map((field, fIdx) => (
              <div key={fIdx} className="ai-inline-profile-field">
                <span className="ai-inline-profile-label">{field.label}</span>
                <span className="ai-inline-profile-value">
                  {field.value}
                  {field.confidence === "ai_inferred" && (
                    <span className="ai-inline-confidence-badge ai-inferred" title="AI-generated data">
                      AI
                    </span>
                  )}
                  {field.confidence === "computed" && (
                    <span className="ai-inline-confidence-badge computed" title="Computed from other data">
                      Calc
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Inline Metric Component ───────────────────────────────── */

function InlineMetric({ data }: { data: InlineMetricData }) {
  return (
    <div className="ai-inline-metric">
      <div className="ai-inline-metric-title">{data.title}</div>
      <div className="ai-inline-metric-cards">
        {data.cards.map((card, cIdx) => (
          <div key={cIdx} className="ai-inline-metric-card">
            <div className="ai-inline-metric-label">{card.label}</div>
            <div className="ai-inline-metric-value">
              {card.value}
              {card.confidence === "ai_inferred" && (
                <span className="ai-inline-confidence-badge ai-inferred" title="AI-generated">AI</span>
              )}
            </div>
            {card.change && (
              <div className="ai-inline-metric-change">{card.change}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Inline Clarification Component ────────────────────────── */

function InlineClarification({
  data,
  onSelect,
}: {
  data: ClarificationData;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="ai-inline-clarification">
      <div className="ai-inline-clarification-question">{data.question}</div>
      <div className="ai-inline-clarification-options">
        {data.options.map((option, oIdx) => (
          <button
            key={oIdx}
            className="ai-inline-clarification-option"
            onClick={() => onSelect(option.label)}
            title={option.description}
          >
            {option.label}
            {option.description && (
              <span className="ai-inline-clarification-desc">{option.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Inline Confidence Banner ──────────────────────────────── */

function InlineConfidence({ data }: { data: ConfidenceData }) {
  if (data.inferred_fields.length === 0) return null;
  return (
    <div className="ai-inline-confidence-banner">
      <span className="ai-inline-confidence-icon" title="Some data is AI-generated">ℹ</span>
      <span>
        Some data shown is AI-inferred ({data.inferred_fields.join(", ")}).
        These may not be 100% accurate.
      </span>
    </div>
  );
}

/* ── Rich Message Renderer ───────────────────────────────── */

function RichMessageContent({
  content,
  onClarificationSelect,
}: {
  content: string;
  onClarificationSelect?: (value: string) => void;
}) {
  const segments = useMemo(() => parseMessageContent(content), [content]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "table") {
          return <InlineTable key={i} data={seg.data} />;
        }
        if (seg.type === "chart") {
          return <InlineChart key={i} data={seg.data} />;
        }
        if (seg.type === "profile") {
          return <InlineProfile key={i} data={seg.data} />;
        }
        if (seg.type === "metric") {
          return <InlineMetric key={i} data={seg.data} />;
        }
        if (seg.type === "clarification") {
          return <InlineClarification key={i} data={seg.data} onSelect={onClarificationSelect || (() => {})} />;
        }
        if (seg.type === "confidence") {
          return <InlineConfidence key={i} data={seg.data} />;
        }
        if (seg.type === "text") {
          return (
            <p key={i} style={{ whiteSpace: "pre-wrap" }}>
              {seg.content}
            </p>
          );
        }
        return null;
      })}
    </>
  );
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
      {/* ─── Header ─── */}
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
            {/* Show animated progress status while waiting for content */}
            {msg.role === "assistant" && msg.content === "" && sending ? (
              <div className="ai-progress-indicator">
                <div className="ai-progress-sparkle" />
                <span className="ai-progress-text" key={progressStatus}>
                  {progressStatus || "Thinking..."}
                </span>
              </div>
            ) : msg.role === "assistant" && (
              msg.content.includes("<!--INLINE_") ||
              msg.content.includes("<!--CLARIFICATION:") ||
              msg.content.includes("<!--CONFIDENCE:")
            ) ? (
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
