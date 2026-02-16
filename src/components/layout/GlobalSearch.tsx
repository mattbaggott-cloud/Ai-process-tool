"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ── Types ─────────────────────────────────────────────── */

interface SearchResultItem {
  id: string;
  sourceTable: string;
  sourceId: string;
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, unknown>;
}

/* ── Table → page mapping ──────────────────────────────── */

const TABLE_ROUTES: Record<string, string> = {
  goals: "/organization/goals",
  sub_goals: "/organization/goals",
  pain_points: "/organization/goals",
  library_items: "/library",
  library_files: "/library",
  organization_files: "/organization",
  team_files: "/teams",
  crm_contacts: "/crm?tab=contacts",
  crm_companies: "/crm?tab=companies",
  crm_deals: "/crm?tab=deals",
  crm_activities: "/crm?tab=activities",
};

const TABLE_LABELS: Record<string, string> = {
  goals: "Goal",
  sub_goals: "Sub-Goal",
  pain_points: "Pain Point",
  library_items: "Library",
  library_files: "File",
  organization_files: "Org Doc",
  team_files: "Team Doc",
  crm_contacts: "Contact",
  crm_companies: "Company",
  crm_deals: "Deal",
  crm_activities: "Activity",
};

const TABLE_COLORS: Record<string, string> = {
  goals: "#2563eb",
  sub_goals: "#3b82f6",
  pain_points: "#ef4444",
  library_items: "#8b5cf6",
  library_files: "#6366f1",
  organization_files: "#059669",
  team_files: "#0891b2",
  crm_contacts: "#0d9488",
  crm_companies: "#4f46e5",
  crm_deals: "#d97706",
  crm_activities: "#64748b",
};

/* ── Component ─────────────────────────────────────────── */

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ── Keyboard shortcut: Cmd+K / Ctrl+K ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  /* ── Focus input when modal opens ── */
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  /* ── Debounced search ── */
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.results ?? []);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  /* ── Navigate to result ── */
  const navigateToResult = (result: SearchResultItem) => {
    const route = TABLE_ROUTES[result.sourceTable] ?? "/";
    router.push(route);
    setOpen(false);
  };

  /* ── Keyboard navigation inside results ── */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      navigateToResult(results[selectedIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="global-search-overlay" onClick={() => setOpen(false)}>
      <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="global-search-input-wrap">
          <svg className="global-search-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M12 12l4 4" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="global-search-input"
            placeholder="Search goals, pain points, library, files..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="global-search-kbd">Esc</kbd>
        </div>

        {/* Results */}
        <div className="global-search-results">
          {loading && query.trim() && (
            <div className="global-search-status">Searching...</div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="global-search-status">No results found</div>
          )}

          {!loading && results.length > 0 && (
            <ul className="global-search-list">
              {results.map((r, i) => {
                const label = TABLE_LABELS[r.sourceTable] ?? r.sourceTable;
                const color = TABLE_COLORS[r.sourceTable] ?? "#6b7280";

                return (
                  <li
                    key={r.id}
                    className={`global-search-item ${i === selectedIndex ? "global-search-item-selected" : ""}`}
                    onClick={() => navigateToResult(r)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span
                      className="global-search-badge"
                      style={{ backgroundColor: color + "18", color }}
                    >
                      {label}
                    </span>
                    <div className="global-search-item-content">
                      <div className="global-search-item-title">{r.title}</div>
                      <div className="global-search-item-snippet">{r.snippet}</div>
                    </div>
                    <span className="global-search-score">
                      {Math.round(r.score * 100)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {!query.trim() && (
            <div className="global-search-status global-search-hint">
              Type to search across all your workspace data
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="global-search-footer">
          <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
