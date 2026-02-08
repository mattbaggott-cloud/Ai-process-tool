"use client";

import React, { useRef, useCallback, useEffect } from "react";
import type { ListItem } from "@/lib/types/database";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface ChecklistBlockProps {
  items: ListItem[];
  onChange: (items: ListItem[]) => void;
}

export default function ChecklistBlock({ items, onChange }: ChecklistBlockProps) {
  const focusRef = useRef<string | null>(null);

  /* Auto-focus newly added items */
  useEffect(() => {
    if (focusRef.current) {
      const el = document.querySelector(
        `[data-checklist-id="${focusRef.current}"]`
      ) as HTMLElement | null;
      if (el) {
        el.focus();
        const sel = window.getSelection();
        if (sel) { sel.selectAllChildren(el); sel.collapseToEnd(); }
      }
      focusRef.current = null;
    }
  });

  const toggleCheck = useCallback(
    (id: string) => {
      onChange(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
    },
    [items, onChange]
  );

  const updateItem = useCallback(
    (id: string, text: string) => {
      onChange(items.map((it) => (it.id === id ? { ...it, text } : it)));
    },
    [items, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      /* Format shortcuts */
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "b") { e.preventDefault(); document.execCommand("bold"); return; }
      if (mod && e.key === "i") { e.preventDefault(); document.execCommand("italic"); return; }
      if (mod && e.key === "u") { e.preventDefault(); document.execCommand("underline"); return; }

      if (e.key === "Enter") {
        e.preventDefault();
        const newItem: ListItem = { id: uid(), text: "", checked: false };
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
          if (idx > 0) focusRef.current = items[idx - 1].id;
        }
      }
    },
    [items, onChange]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }, []);

  return (
    <div className="canvas-checklist">
      {items.map((item, idx) => (
        <div key={item.id} className="canvas-checklist-item">
          <input
            type="checkbox"
            className="canvas-checklist-checkbox"
            checked={item.checked ?? false}
            onChange={() => toggleCheck(item.id)}
          />
          <ChecklistItemEditor
            item={item}
            onInput={(text) => updateItem(item.id, text)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onPaste={handlePaste}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Single checklist item editor ── */
function ChecklistItemEditor({
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
      className={`canvas-checklist-text ${item.checked ? "checked" : ""}`}
      contentEditable
      suppressContentEditableWarning
      data-placeholder="To-do…"
      data-checklist-id={item.id}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
    />
  );
}
