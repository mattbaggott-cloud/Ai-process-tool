"use client";

import React, { useEffect, useRef, useState } from "react";
import type { CanvasBlockType } from "@/lib/types/database";

/* ── Menu items ─────────────────────────────────────── */
export const slashCommands: {
  type: CanvasBlockType;
  label: string;
  icon: string;
  level?: 1 | 2 | 3;
  keywords?: string;
}[] = [
  { type: "text",          label: "Text",          icon: "T",  keywords: "paragraph" },
  { type: "heading",       label: "Heading 1",     icon: "H1", level: 1, keywords: "title h1" },
  { type: "heading",       label: "Heading 2",     icon: "H2", level: 2, keywords: "subtitle h2" },
  { type: "heading",       label: "Heading 3",     icon: "H3", level: 3, keywords: "h3" },
  { type: "bullet_list",   label: "Bullet List",   icon: "•",  keywords: "unordered ul" },
  { type: "numbered_list", label: "Numbered List",  icon: "1.", keywords: "ordered ol" },
  { type: "checklist",     label: "Checklist",     icon: "☑",  keywords: "todo checkbox task" },
  { type: "table",         label: "Table",         icon: "⊞",  keywords: "grid spreadsheet" },
  { type: "code",          label: "Code",          icon: "<>", keywords: "snippet pre" },
  { type: "chart",         label: "Chart",         icon: "📊", keywords: "graph visualization bar line pie" },
  { type: "divider",       label: "Divider",       icon: "—",  keywords: "separator line hr" },
  { type: "image",         label: "Image",         icon: "🖼",  keywords: "picture photo" },
  { type: "column_group",  label: "Columns",       icon: "◫",  keywords: "side by side column split layout" },
];

/* ══════════════════════════════════════════════════════════ */

interface SlashCommandMenuProps {
  position: { top: number; left: number };
  filter: string;
  onSelect: (type: CanvasBlockType, level?: 1 | 2 | 3) => void;
  onClose: () => void;
}

export default function SlashCommandMenu({
  position,
  filter,
  onSelect,
  onClose,
}: SlashCommandMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  /* Filter commands */
  const filtered = slashCommands.filter((cmd) => {
    const q = filter.toLowerCase();
    if (!q) return true;
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.type.toLowerCase().includes(q) ||
      (cmd.keywords?.toLowerCase().includes(q) ?? false)
    );
  });

  /* Reset active index when filter changes */
  useEffect(() => {
    setActiveIdx(0);
  }, [filter]);

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  /* Keyboard navigation */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIdx]) {
          onSelect(filtered[activeIdx].type, filtered[activeIdx].level);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, activeIdx, onSelect, onClose]);

  /* Scroll active item into view */
  useEffect(() => {
    const el = ref.current?.querySelector(".slash-menu-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (filtered.length === 0) {
    return (
      <div
        ref={ref}
        className="slash-menu"
        style={{ top: position.top, left: position.left }}
      >
        <div className="slash-menu-empty">No matching commands</div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="slash-menu"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.label}
          className={`slash-menu-item ${idx === activeIdx ? "active" : ""}`}
          onMouseEnter={() => setActiveIdx(idx)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus on contentEditable
            onSelect(cmd.type, cmd.level);
          }}
        >
          <span className="slash-menu-icon">{cmd.icon}</span>
          {cmd.label}
        </button>
      ))}
    </div>
  );
}
