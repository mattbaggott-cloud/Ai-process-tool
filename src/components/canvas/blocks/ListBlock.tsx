"use client";

import React, { useRef, useCallback, useEffect } from "react";
import type { ListItem } from "@/lib/types/database";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface ListBlockProps {
  items: ListItem[];
  ordered: boolean;
  onChange: (items: ListItem[]) => void;
}

export default function ListBlock({ items, ordered, onChange }: ListBlockProps) {
  const focusRef = useRef<string | null>(null);

  /* Auto-focus newly added items */
  useEffect(() => {
    if (focusRef.current) {
      const el = document.querySelector(
        `[data-list-item-id="${focusRef.current}"]`
      ) as HTMLElement | null;
      if (el) {
        el.focus();
        /* Place cursor at end */
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(el);
          sel.collapseToEnd();
        }
      }
      focusRef.current = null;
    }
  });

  const updateItem = useCallback(
    (id: string, text: string) => {
      onChange(items.map((it) => (it.id === id ? { ...it, text } : it)));
    },
    [items, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const newItem: ListItem = { id: uid(), text: "" };
        const next = [...items];
        next.splice(idx + 1, 0, newItem);
        onChange(next);
        focusRef.current = newItem.id;
      }
      if (e.key === "Backspace") {
        const el = e.target as HTMLElement;
        if ((el.textContent ?? "").trim() === "" && items.length > 1) {
          e.preventDefault();
          const next = items.filter((_, i) => i !== idx);
          onChange(next);
          /* Focus previous item */
          if (idx > 0) {
            focusRef.current = items[idx - 1].id;
          }
        }
      }
    },
    [items, onChange]
  );

  /* Handle paste: strip HTML */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  /* Format shortcuts */
  const handleFormat = useCallback((e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
    if (mod && e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
    if (mod && e.key === "u") { e.preventDefault(); document.execCommand("underline"); }
  }, []);

  return (
    <div className="canvas-list">
      {items.map((item, idx) => (
        <div key={item.id} className="canvas-list-item">
          <span className="canvas-list-marker">
            {ordered ? `${idx + 1}.` : "•"}
          </span>
          <ListItemEditor
            item={item}
            onInput={(text) => updateItem(item.id, text)}
            onKeyDown={(e) => { handleFormat(e); handleKeyDown(e, idx); }}
            onPaste={handlePaste}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Single list item editor ── */
function ListItemEditor({
  item,
  onInput,
  onKeyDown,
  onPaste,
}: {
  item: ListItem;
  onInput: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = item.text;
    }
  }, [item.text]);

  const handleInput = useCallback(() => {
    if (isComposing.current || !ref.current) return;
    onInput(ref.current.innerHTML);
  }, [onInput]);

  return (
    <div
      ref={ref}
      className="canvas-list-text"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="List item…"
      data-list-item-id={item.id}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
    />
  );
}
