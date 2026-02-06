"use client";

import React, { useState } from "react";
import Link from "next/link";

/* ══════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════ */

interface Activity {
  id: string;
  text: string;
  time: string;
  category: "explore" | "team" | "goal" | "flow" | "system";
}

/* ── ID helper ─────────────────────────────────────────── */

let counter = 0;
const uid = () => `a-${++counter}-${Date.now()}`;

/* ── Time formatter ────────────────────────────────────── */

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/* ══════════════════════════════════════════════════════════
   SVG ICONS (16×16 stroke-based)
   ══════════════════════════════════════════════════════════ */

const icons = {
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  target: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  ),
  flow: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 8.5h4.5a2 2 0 0 1 2 2V14" />
    </svg>
  ),
  book: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </svg>
  ),
  activity: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  arrowRight: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
};

/* ══════════════════════════════════════════════════════════
   QUICK ACTIONS CONFIG
   ══════════════════════════════════════════════════════════ */

const quickActions = [
  {
    icon: icons.users,
    title: "Team Builder",
    desc: "Map roles, KPIs, and tools",
    href: "/teams/sales",
  },
  {
    icon: icons.target,
    title: "Goals",
    desc: "Set and track SMART objectives",
    href: "/goals",
  },
  {
    icon: icons.flow,
    title: "Process Flows",
    desc: "Design workflows visually",
    href: "/projects",
  },
  {
    icon: icons.search,
    title: "Tool Comparison",
    desc: "Evaluate AI & automation solutions",
    href: "/tools",
  },
];

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [activities, setActivities] = useState<Activity[]>([
    {
      id: "seed-1",
      text: "Workspace created — start by building your first team or setting a goal",
      time: new Date().toISOString(),
      category: "system",
    },
  ]);

  /* ── Stats ── */
  const stats = [
    { label: "Teams Mapped", value: "3", trend: "+1 this week", icon: icons.users },
    { label: "Active Goals", value: "0", trend: "Set your first", icon: icons.target },
    { label: "Flows Created", value: "2", trend: "In progress", icon: icons.flow },
    { label: "Library Items", value: "0", trend: "Start saving", icon: icons.book },
  ];

  /* ── Handle explore prompt ── */
  const handleExplore = () => {
    if (!prompt.trim()) return;
    const newActivity: Activity = {
      id: uid(),
      text: `Exploring: "${prompt}"`,
      time: new Date().toISOString(),
      category: "explore",
    };
    setActivities([newActivity, ...activities]);
    setPrompt("");
  };

  const clearActivity = () => setActivities([]);

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header">
        <h1 className="canvas-title">Welcome Back</h1>
        <p className="canvas-subtitle">Your AI workspace at a glance</p>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">

        {/* ── Explore Prompt ── */}
        <div className="home-explore-card">
          <h3 className="home-explore-title">What do you want to explore?</h3>
          <p className="home-explore-desc">
            Describe a challenge, opportunity, or process you want to optimize
          </p>
          <div className="home-explore-input-row">
            <input
              className="input"
              placeholder="e.g. How can we scale our SDR team while keeping costs flat?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExplore()}
            />
            <button className="btn btn-primary" onClick={handleExplore}>
              Explore
            </button>
          </div>
        </div>

        {/* ── Stats Grid ── */}
        <div className="stat-grid" style={{ marginBottom: 32 }}>
          {stats.map((s) => (
            <div key={s.label} className="stat-box home-stat-box">
              <div className="home-stat-header">
                <div className="stat-value">{s.value}</div>
                <span className="home-stat-icon">{s.icon}</span>
              </div>
              <div className="stat-label">{s.label}</div>
              <div className="home-stat-trend">{s.trend}</div>
            </div>
          ))}
        </div>

        {/* ── Getting Started Checklist ── */}
        <div className="home-checklist" style={{ marginBottom: 32 }}>
          <h3 className="home-checklist-title">Getting Started</h3>
          <div className="home-checklist-items">
            {[
              { text: "Map your first team", href: "/teams/sales", done: false },
              { text: "Set a business goal", href: "/goals", done: false },
              { text: "Create a process flow", href: "/projects", done: false },
              { text: "Save a note to the library", href: "/library", done: false },
              { text: "Run a brainstorm session", href: "/brainstorm", done: false },
            ].map((item) => (
              <Link key={item.text} href={item.href} prefetch={false} className="home-checklist-item">
                <span className={`home-check-circle ${item.done ? "home-check-circle-done" : ""}`}>
                  {item.done && icons.check}
                </span>
                <span className={item.done ? "home-check-done" : ""}>{item.text}</span>
                <span className="home-check-arrow">{icons.arrowRight}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2 className="section-title">Recent Activity</h2>
          {activities.length > 0 && (
            <button className="text-link" onClick={clearActivity}>Clear all</button>
          )}
        </div>

        {activities.length === 0 ? (
          <div className="empty-state" style={{ marginBottom: 32 }}>
            <h3>No activity yet</h3>
            <p>Start by exploring a question above or building a team model from the sidebar.</p>
          </div>
        ) : (
          <div className="home-activity-list" style={{ marginBottom: 32 }}>
            {activities.map((a) => (
              <div key={a.id} className="home-activity-row">
                <span className="home-activity-dot" />
                <div className="home-activity-text">{a.text}</div>
                <span className="home-activity-time">{timeAgo(a.time)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2 className="section-title">Quick Actions</h2>
        </div>
        <div className="home-actions-grid">
          {quickActions.map((a) => (
            <Link key={a.title} href={a.href} prefetch={false} className="card-link">
              <div className="home-action-card">
                <span className="home-action-icon">{a.icon}</span>
                <div className="home-action-body">
                  <div className="home-action-title">{a.title}</div>
                  <div className="home-action-desc">{a.desc}</div>
                </div>
                <span className="home-action-arrow">{icons.arrowRight}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
