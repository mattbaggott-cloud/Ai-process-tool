"use client";

import Sidebar from "./Sidebar";
import AIChat from "./AIChat";
import ErrorBoundary from "./ErrorBoundary";
import { FileProvider } from "@/context/FileContext";
import { LayoutProvider, useLayout } from "@/context/LayoutContext";

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { hideRightPanel, sidebarCollapsed, chatOpen, toggleChat } = useLayout();

  const containerClasses = [
    "app-container",
    hideRightPanel ? "app-container-no-chat" : "",
    sidebarCollapsed ? "app-container-sidebar-collapsed" : "",
    !chatOpen && !hideRightPanel ? "app-container-chat-closed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {/* Left Sidebar – 280px / 60px collapsed */}
      <Sidebar />

      {/* Center Canvas – fills remaining space */}
      <main className="center-canvas">
        {/* AI Chat toggle button — only visible when chat is closed */}
        {!hideRightPanel && !chatOpen && (
          <button
            className="ai-toggle-btn"
            onClick={toggleChat}
            title="Open AI Copilot"
            aria-label="Open AI Copilot"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1L12 5L8 9L4 5Z" />
              <path d="M2.5 9v1.5a3.5 3.5 0 003.5 3.5h4a3.5 3.5 0 003.5-3.5V9" />
            </svg>
            <span className="ai-toggle-label">AI</span>
          </button>
        )}
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Right Panel – AI Chat – always rendered for message persistence */}
      {!hideRightPanel && (
        <div className={`ai-panel-wrapper ${chatOpen ? "ai-panel-open" : "ai-panel-closed"}`}>
          <AIChat />
        </div>
      )}
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
