"use client";

import Sidebar from "./Sidebar";
import AIChat from "./AIChat";
import ErrorBoundary from "./ErrorBoundary";
import { FileProvider } from "@/context/FileContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FileProvider>
      <div className="app-container">
        {/* Left Sidebar – 280 px */}
        <Sidebar />

        {/* Center Canvas – fills remaining space */}
        <main className="center-canvas">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>

        {/* Right Panel – AI Chat – 380 px */}
        <AIChat />
      </div>
    </FileProvider>
  );
}
