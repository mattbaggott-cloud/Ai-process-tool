"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { CanvasBlock, CanvasBlockType } from "@/lib/types/database";

/* ── Generate a simple unique ID ─────────────────────── */
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ── Create a blank block ─────────────────────────────── */
function blankBlock(type: CanvasBlockType = "text", level?: 1 | 2 | 3): CanvasBlock {
  const base: CanvasBlock = { id: uid(), type };
  if (type === "text") base.content = "";
  if (type === "heading") { base.content = ""; base.level = level ?? 2; }
  if (type === "image") { base.url = ""; base.alt = ""; }
  return base;
}

/* ── Block type menu options ──────────────────────────── */
const blockTypes: { type: CanvasBlockType; label: string; icon: string; level?: 1 | 2 | 3 }[] = [
  { type: "text",    label: "Text",       icon: "T" },
  { type: "heading", label: "Heading 1",  icon: "H1", level: 1 },
  { type: "heading", label: "Heading 2",  icon: "H2", level: 2 },
  { type: "heading", label: "Heading 3",  icon: "H3", level: 3 },
  { type: "divider", label: "Divider",    icon: "—" },
  { type: "image",   label: "Image",      icon: "🖼" },
];

/* ══════════════════════════════════════════════════════════
   RICH TEXT BLOCK — contentEditable with formatting shortcuts
   ══════════════════════════════════════════════════════════ */

function RichTextBlock({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);

  /* Set initial content on mount */
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = content;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync external changes (e.g. AI tool updates) when not focused */
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = content;
    }
  }, [content]);

  const handleInput = useCallback(() => {
    if (isComposing.current || !ref.current) return;
    /* Normalize empty state so CSS :empty placeholder shows */
    const text = ref.current.textContent ?? "";
    if (text.trim() === "" && ref.current.innerHTML !== "") {
      ref.current.innerHTML = "";
    }
    onChange(ref.current.innerHTML);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
    if (mod && e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
    if (mod && e.key === "u") { e.preventDefault(); document.execCommand("underline"); }
  }, []);

  /* Strip HTML on paste — insert plain text only */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  return (
    <div
      ref={ref}
      className="canvas-text-input"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Start typing…"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   CANVAS EDITOR
   ══════════════════════════════════════════════════════════ */

interface CanvasEditorProps {
  blocks: CanvasBlock[];
  onChange: (blocks: CanvasBlock[]) => void;
}

export default function CanvasEditor({ blocks, onChange }: CanvasEditorProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close add-block menu on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuIdx(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Block CRUD ── */
  const updateBlock = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, onChange]
  );

  const deleteBlock = useCallback(
    (id: string) => {
      const next = blocks.filter((b) => b.id !== id);
      onChange(next.length === 0 ? [blankBlock("text")] : next);
    },
    [blocks, onChange]
  );

  const insertBlock = useCallback(
    (afterIdx: number, type: CanvasBlockType, level?: 1 | 2 | 3) => {
      const next = [...blocks];
      next.splice(afterIdx + 1, 0, blankBlock(type, level));
      onChange(next);
      setMenuIdx(null);
    },
    [blocks, onChange]
  );

  /* ── Drag and drop ── */
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const next = [...blocks];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    onChange(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  /* ── Empty state: seed with one blank text block ── */
  useEffect(() => {
    if (blocks.length === 0) {
      onChange([blankBlock("text")]);
    }
  }, [blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="canvas-editor">
      {blocks.map((block, idx) => (
        <React.Fragment key={block.id}>
          {/* Block row */}
          <div
            className={`canvas-block ${dragOverIdx === idx ? "canvas-block-drag-over" : ""}`}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          >
            {/* Drag handle */}
            <div className="canvas-drag-handle" title="Drag to reorder">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="#9ca3af">
                <circle cx="3" cy="3" r="1.5" />
                <circle cx="7" cy="3" r="1.5" />
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="7" cy="8" r="1.5" />
                <circle cx="3" cy="13" r="1.5" />
                <circle cx="7" cy="13" r="1.5" />
              </svg>
            </div>

            {/* Block content */}
            <div className="canvas-block-content">
              {block.type === "text" && (
                <RichTextBlock
                  content={block.content ?? ""}
                  onChange={(html) => updateBlock(block.id, { content: html })}
                />
              )}

              {block.type === "heading" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    className="canvas-heading-select"
                    value={block.level ?? 2}
                    onChange={(e) => updateBlock(block.id, { level: Number(e.target.value) as 1 | 2 | 3 })}
                  >
                    <option value={1}>H1</option>
                    <option value={2}>H2</option>
                    <option value={3}>H3</option>
                  </select>
                  <input
                    className="canvas-heading-input"
                    style={{
                      fontSize: block.level === 1 ? 24 : block.level === 2 ? 20 : 16,
                      fontWeight: 600,
                    }}
                    placeholder="Heading…"
                    value={block.content ?? ""}
                    onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                  />
                </div>
              )}

              {block.type === "divider" && <hr className="canvas-divider" />}

              {block.type === "image" && (
                <div className="canvas-image-block">
                  {block.url ? (
                    <img
                      src={block.url}
                      alt={block.alt || ""}
                      style={{ maxWidth: "100%", borderRadius: 8 }}
                    />
                  ) : (
                    <input
                      className="input"
                      placeholder="Paste an image URL…"
                      value={block.url ?? ""}
                      onChange={(e) => updateBlock(block.id, { url: e.target.value })}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Delete button */}
            <button
              className="canvas-block-delete"
              onClick={() => deleteBlock(block.id)}
              title="Delete block"
            >
              &times;
            </button>
          </div>

          {/* Add block button between blocks */}
          <div className="canvas-add-row">
            <button
              className="canvas-add-btn"
              onClick={() => setMenuIdx(menuIdx === idx ? null : idx)}
              title="Add block"
            >
              +
            </button>
            {menuIdx === idx && (
              <div ref={menuRef} className="canvas-add-menu">
                {blockTypes.map((bt) => (
                  <button
                    key={bt.label}
                    className="canvas-add-menu-item"
                    onClick={() => insertBlock(idx, bt.type, bt.level)}
                  >
                    <span className="canvas-add-menu-icon">{bt.icon}</span>
                    {bt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
