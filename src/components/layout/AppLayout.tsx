"use client";

import Sidebar from "./Sidebar";
import AIChat from "./AIChat";
import ErrorBoundary from "./ErrorBoundary";
import { FileProvider } from "@/context/FileContext";
import { LayoutProvider, useLayout } from "@/context/LayoutContext";

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { hideRightPanel, sidebarCollapsed } = useLayout();

  const containerClasses = [
    "app-container",
    hideRightPanel ? "app-container-no-chat" : "",
    sidebarCollapsed ? "app-container-sidebar-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {/* Left Sidebar – 280px / 60px collapsed */}
      <Sidebar />

      {/* Center Canvas – fills remaining space */}
      <main className="center-canvas">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Right Panel – AI Chat – 380 px (hidden when in full chat mode) */}
      {!hideRightPanel && <AIChat />}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FileProvider>
      <LayoutProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </LayoutProvider>
    </FileProvider>
  );
}
