"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/* ── navigation data ─────────────────────────────────────── */

const mainNav = [
  { label: "Home",       href: "/",           icon: "home" },
  { label: "Goals",      href: "/goals",      icon: "target" },
  { label: "Library",    href: "/library",     icon: "book" },
  { label: "Brainstorm", href: "/brainstorm",  icon: "zap" },
  { label: "Tools",      href: "/tools",       icon: "wrench" },
];

const teams = [
  { label: "Sales",            href: "/teams/sales" },
  { label: "Marketing",        href: "/teams/marketing" },
  { label: "Customer Success",  href: "/teams/customer-success" },
];

const projects = [
  { label: "SDR → AE Pipeline",      href: "/projects/sdr-pipeline" },
  { label: "Outbound Prospecting",   href: "/projects/outbound" },
  { label: "Lead Qualification",     href: "/projects/lead-qualification" },
];

/* ── tiny SVG icons (no dependency needed) ───────────────── */

const icons: Record<string, React.ReactNode> = {
  home: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.5Z" />
      <path d="M6 14V9h4v5" />
    </svg>
  ),
  target: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3" /><circle cx="8" cy="8" r=".75" fill="currentColor" />
    </svg>
  ),
  book: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2.5h4a2 2 0 0 1 2 2V13a1.5 1.5 0 0 0-1.5-1.5H2V2.5ZM14 2.5h-4a2 2 0 0 0-2 2V13a1.5 1.5 0 0 1 1.5-1.5H14V2.5Z" />
    </svg>
  ),
  zap: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5 3 9h5l-1 5.5L13 7H8l1-5.5Z" />
    </svg>
  ),
  wrench: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 2.3a3.5 3.5 0 0 0-4.1 5.5L2.5 11.5a1.4 1.4 0 0 0 2 2l3.7-3.7a3.5 3.5 0 0 0 5.5-4.1L11.5 7.8 9.2 5.5l2.1-2.1-.7-.7-.3-.4Z" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="2" /><path d="M1.5 13.5a4 4 0 0 1 8 0" />
      <circle cx="11" cy="5.5" r="1.5" /><path d="M14.5 13.5a3 3 0 0 0-4.5-2.6" />
    </svg>
  ),
  layout: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M2 6h12M6 6v8" />
    </svg>
  ),
};

/* ── component ───────────────────────────────────────────── */

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="sidebar">
      {/* ─── Logo ─── */}
      <div className="sidebar-header">
        <span className="logo">AI Workspace</span>
      </div>

      {/* ─── Main nav ─── */}
      <nav className="sidebar-nav">
        <div className="nav-section">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`nav-item ${isActive(item.href) ? "active" : ""}`}
            >
              <span className="nav-icon">{icons[item.icon]}</span>
              {item.label}
            </Link>
          ))}
        </div>

        {/* ─── Business Model ─── */}
        <div className="nav-section">
          <div className="nav-section-title">Business Model</div>
          <div className="nav-item nav-parent">
            <span className="nav-icon">{icons.users}</span>
            Teams
          </div>
          {teams.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              prefetch={false}
              className={`nav-item-sub ${isActive(t.href) ? "active" : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* ─── Workspace ─── */}
        <div className="nav-section">
          <div className="nav-section-title">Workspace</div>
          <Link
            href="/projects"
            prefetch={false}
            className={`nav-item ${pathname === "/projects" ? "active" : ""}`}
          >
            <span className="nav-icon">{icons.layout}</span>
            Projects
          </Link>
          {projects.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              prefetch={false}
              className={`nav-item-sub ${isActive(p.href) ? "active" : ""}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ─── Bottom buttons ─── */}
      <div className="sidebar-footer">
        <button className="btn btn-primary btn-full">+ New Project</button>
        <button className="btn btn-secondary btn-full">Upload Flow</button>
      </div>
    </aside>
  );
}
