"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLayout } from "@/context/LayoutContext";
import { createClient } from "@/lib/supabase/client";
import GlobalSearch from "./GlobalSearch";

/* ── navigation data ─────────────────────────────────────── */

const mainNav = [
  { label: "Home",       href: "/",           icon: "home" },
  { label: "Dashboards", href: "/dashboards",  icon: "chart" },
  { label: "CRM",        href: "/crm",         icon: "briefcase" },
  { label: "Explorer",   href: "/explorer",    icon: "target" },
  { label: "Segments",   href: "/segments",    icon: "segments" },
  { label: "Reports",    href: "/reports",     icon: "report" },
  { label: "Data",       href: "/data",        icon: "database" },
  { label: "Library",    href: "/library",     icon: "book" },
  { label: "Tools",      href: "/tools",       icon: "wrench" },
  { label: "Settings",   href: "/settings",    icon: "gear" },
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
  building: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14V3.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V14" />
      <path d="M1.5 14h13" />
      <path d="M6 5.5h1M9 5.5h1M6 8h1M9 8h1M6.5 14v-2.5h3V14" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="2" /><path d="M1.5 13.5a4 4 0 0 1 8 0" />
      <circle cx="11" cy="5.5" r="1.5" /><path d="M14.5 13.5a3 3 0 0 0-4.5-2.6" />
    </svg>
  ),
  briefcase: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="12" height="9" rx="1" /><path d="M6 5V3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5V5" /><path d="M2 9h12" />
    </svg>
  ),
  database: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="4" rx="5.5" ry="2" />
      <path d="M2.5 4v8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" />
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  ),
  layout: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M2 6h12M6 6v8" />
    </svg>
  ),
  chart: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13V8M7 13V5M11 13V2" />
    </svg>
  ),
  report: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </svg>
  ),
  segments: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="3" /><circle cx="11" cy="5" r="3" /><circle cx="8" cy="11" r="3" />
    </svg>
  ),
  gear: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v1.25M8 13.25v1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M1.5 8h1.25M13.25 8h1.25M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
    </svg>
  ),
};

/* ── component ───────────────────────────────────────────── */

/* ── collapse toggle icon ─────────────────────────────────── */
const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {collapsed ? (
      /* chevron-right → expand */
      <path d="M6 3l5 5-5 5" />
    ) : (
      /* chevron-left → collapse */
      <path d="M10 3l-5 5 5 5" />
    )}
  </svg>
);

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useLayout();

  /* ── Load teams, org name, and projects dynamically ── */
  const [sidebarTeams, setSidebarTeams] = useState<{ slug: string; name: string }[]>([]);
  const [sidebarProjects, setSidebarProjects] = useState<{ slug: string; name: string }[]>([]);
  const [orgName, setOrgName] = useState<string>("");
  const loadSidebarData = useCallback(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("teams")
      .select("slug, name")
      .order("created_at")
      .then(({ data }) => {
        if (data) setSidebarTeams(data.map((t) => ({ slug: t.slug, name: t.name || t.slug })));
      });
    supabase
      .from("org_profiles")
      .select("name")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.name) setOrgName(data.name);
      });
    supabase
      .from("projects")
      .select("slug, name")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setSidebarProjects(data.map((p) => ({ slug: p.slug, name: p.name })));
      });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSidebarData(); }, [loadSidebarData]);

  /* Listen for AI-triggered data changes */
  useEffect(() => {
    const handler = () => loadSidebarData();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadSidebarData]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* ─── Header ─── */}
      <div className="sidebar-header">
        {!sidebarCollapsed && <span className="logo">AI Workspace</span>}
        <button
          className="sidebar-toggle-btn"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <CollapseIcon collapsed={sidebarCollapsed} />
        </button>
      </div>

      {/* ─── Search trigger ─── */}
      <button
        className="sidebar-search-btn"
        onClick={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
        title={sidebarCollapsed ? "Search (⌘K)" : undefined}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="4.5" /><path d="M10 10l3 3" />
        </svg>
        {!sidebarCollapsed && <span>Search</span>}
        {!sidebarCollapsed && <kbd>⌘K</kbd>}
      </button>

      {/* ─── Main nav ─── */}
      <nav className="sidebar-nav">
        <div className="nav-section">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`nav-item ${isActive(item.href) ? "active" : ""}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{icons[item.icon]}</span>
              {!sidebarCollapsed && item.label}
            </Link>
          ))}
        </div>

        {/* ─── Business Model ─── */}
        <div className="nav-section">
          {!sidebarCollapsed && <div className="nav-section-title">Business Model</div>}

          {/* Organization */}
          <Link
            href="/organization"
            prefetch={false}
            className={`nav-item ${pathname === "/organization" ? "active" : ""}`}
            title={sidebarCollapsed ? (orgName || "Organization") : undefined}
          >
            <span className="nav-icon">{icons.building}</span>
            {!sidebarCollapsed && (orgName || "Organization")}
          </Link>
          {!sidebarCollapsed && (
            <Link
              href="/organization/goals"
              prefetch={false}
              className={`nav-item-sub ${isActive("/organization/goals") ? "active" : ""}`}
            >
              Goals & Pain Points
            </Link>
          )}
          {!sidebarCollapsed && (
            <Link
              href="/organization/products"
              prefetch={false}
              className={`nav-item-sub ${isActive("/organization/products") ? "active" : ""}`}
            >
              Products
            </Link>
          )}

          {/* Teams */}
          <Link
            href="/teams"
            prefetch={false}
            className={`nav-item ${pathname === "/teams" ? "active" : ""}`}
            title={sidebarCollapsed ? "Teams" : undefined}
          >
            <span className="nav-icon">{icons.users}</span>
            {!sidebarCollapsed && "Teams"}
          </Link>
          {!sidebarCollapsed &&
            sidebarTeams.map((t) => (
              <Link
                key={t.slug}
                href={`/teams/${t.slug}`}
                prefetch={false}
                className={`nav-item-sub ${isActive(`/teams/${t.slug}`) ? "active" : ""}`}
              >
                {t.name}
              </Link>
            ))}

        </div>

        {/* ─── Workspace ─── */}
        <div className="nav-section">
          {!sidebarCollapsed && <div className="nav-section-title">Workspace</div>}
          <Link
            href="/brainstorm"
            prefetch={false}
            className={`nav-item ${pathname === "/brainstorm" ? "active" : ""}`}
            title={sidebarCollapsed ? "Projects" : undefined}
          >
            <span className="nav-icon">{icons.layout}</span>
            {!sidebarCollapsed && "Projects"}
          </Link>
          {!sidebarCollapsed &&
            sidebarProjects.map((p) => (
              <Link
                key={p.slug}
                href={`/projects/${p.slug}`}
                prefetch={false}
                className={`nav-item-sub ${isActive(`/projects/${p.slug}`) ? "active" : ""}`}
              >
                {p.name}
              </Link>
            ))}
        </div>
      </nav>

      {/* ─── User + sign out ─── */}
      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user">
            <Link
              href="/profile"
              className={`sidebar-user-avatar ${pathname === "/profile" ? "sidebar-user-avatar-active" : ""}`}
              title={sidebarCollapsed ? "My Profile" : "Edit profile"}
            >
              {(user.email ?? "U")[0].toUpperCase()}
            </Link>
            {!sidebarCollapsed && (
              <div className="sidebar-user-info">
                <Link href="/profile" className="sidebar-user-email sidebar-user-email-link">
                  {user.email}
                </Link>
              </div>
            )}
          </div>
        )}
        {!sidebarCollapsed && (
          <button
            className="btn btn-secondary btn-full"
            onClick={handleSignOut}
          >
            Sign Out
          </button>
        )}
      </div>

      {/* ─── Global Search Modal (renders via portal) ─── */}
      <GlobalSearch />
    </aside>
  );
}
