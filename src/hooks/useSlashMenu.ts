"use client";

import { useState, useCallback, useRef } from "react";

/* ── Slash Command Type ──────────────────────────────────── */

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: string;
  keywords: string;
}

/* ── Command Registry ────────────────────────────────────── */

export const CHAT_SLASH_COMMANDS: SlashCommand[] = [
  /* ── CRM / B2B ──────────────────────────────────────── */
  {
    command: "/pipeline",
    label: "Pipeline",
    description: "View your deal pipeline",
    icon: "pipeline",
    keywords: "deals kanban board stages sales funnel",
  },
  {
    command: "/people",
    label: "People",
    description: "View contacts & customers",
    icon: "people",
    keywords: "contacts customers crm list",
  },
  {
    command: "/accounts",
    label: "Accounts",
    description: "View companies & accounts",
    icon: "accounts",
    keywords: "companies organizations businesses",
  },
  /* ── E-Commerce / B2C ───────────────────────────────── */
  {
    command: "/customers",
    label: "Customers",
    description: "View e-commerce customers",
    icon: "customers",
    keywords: "ecommerce shoppers buyers b2c consumers",
  },
  {
    command: "/orders",
    label: "Orders",
    description: "View recent orders",
    icon: "orders",
    keywords: "ecommerce purchases transactions sales revenue",
  },
  {
    command: "/products",
    label: "Products",
    description: "View product catalog",
    icon: "products",
    keywords: "ecommerce catalog inventory items skus",
  },
  /* ── Marketing & Projects ───────────────────────────── */
  {
    command: "/campaigns",
    label: "Campaigns",
    description: "View email campaigns",
    icon: "campaigns",
    keywords: "email marketing sequences drip automation",
  },
  {
    command: "/projects",
    label: "Projects",
    description: "View workspace projects",
    icon: "projects",
    keywords: "canvas workflow brainstorm workspace boards",
  },
  /* ── Knowledge ──────────────────────────────────────── */
  {
    command: "/knowledge",
    label: "Knowledge",
    description: "Browse knowledge base",
    icon: "knowledge",
    keywords: "library documents notes templates reference",
  },
  /* ── Dashboard ──────────────────────────────────────── */
  {
    command: "/dashboard",
    label: "Dashboard",
    description: "Overview metrics & highlights",
    icon: "dashboard",
    keywords: "overview summary kpi metrics analytics stats home",
  },
  /* ── Tools ────────────────────────────────────────── */
  {
    command: "/tools",
    label: "Tools",
    description: "View your tech stack",
    icon: "tools",
    keywords: "stack software integrations apps saas technology",
  },
];

/* ── Hook Options ────────────────────────────────────────── */

interface UseSlashMenuOptions {
  onSelect: (cmd: SlashCommand) => void;
}

/* ── Hook Return ─────────────────────────────────────────── */

export interface UseSlashMenuReturn {
  isOpen: boolean;
  filteredCommands: SlashCommand[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  handleInputChange: (value: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  selectCommand: (cmd: SlashCommand) => void;
  close: () => void;
}

/* ── Hook Implementation ─────────────────────────────────── */

export function useSlashMenu({ onSelect }: UseSlashMenuOptions): UseSlashMenuReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* Filter commands by matching against command, label, description, keywords */
  const filteredCommands = isOpen
    ? CHAT_SLASH_COMMANDS.filter((cmd) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          cmd.command.toLowerCase().includes(q) ||
          cmd.label.toLowerCase().includes(q) ||
          cmd.description.toLowerCase().includes(q) ||
          cmd.keywords.toLowerCase().includes(q)
        );
      })
    : [];

  /* Detect "/" at start of input to open/close menu */
  const handleInputChange = useCallback((value: string) => {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      const afterSlash = trimmed.slice(1);
      // Close if there's a space after the command (user finished typing)
      if (afterSlash.includes(" ")) {
        setIsOpen(false);
        return;
      }
      setIsOpen(true);
      setFilter(afterSlash);
      setActiveIndex(0);
    } else {
      setIsOpen(false);
      setFilter("");
    }
  }, []);

  /* Keyboard navigation when menu is open */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (filteredCommands[activeIndex]) {
          e.preventDefault();
          onSelectRef.current(filteredCommands[activeIndex]);
          setIsOpen(false);
          setFilter("");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        setFilter("");
      } else if (e.key === "Tab") {
        if (filteredCommands[activeIndex]) {
          e.preventDefault();
          onSelectRef.current(filteredCommands[activeIndex]);
          setIsOpen(false);
          setFilter("");
        }
      }
    },
    [isOpen, filteredCommands, activeIndex]
  );

  /* Select a command (from click) */
  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      onSelectRef.current(cmd);
      setIsOpen(false);
      setFilter("");
    },
    []
  );

  /* Close menu */
  const close = useCallback(() => {
    setIsOpen(false);
    setFilter("");
  }, []);

  return {
    isOpen,
    filteredCommands,
    activeIndex,
    setActiveIndex,
    handleInputChange,
    handleKeyDown,
    selectCommand,
    close,
  };
}
