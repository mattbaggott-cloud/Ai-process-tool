"use client";

import { createContext, useContext, useState } from "react";

interface LayoutContextValue {
  hideRightPanel: boolean;
  setHideRightPanel: (hide: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  hideRightPanel: false,
  setHideRightPanel: () => {},
  chatOpen: false,
  setChatOpen: () => {},
  toggleChat: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
});

export function useLayout() {
  return useContext(LayoutContext);
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [hideRightPanel, setHideRightPanel] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const toggleChat = () => setChatOpen((prev) => !prev);

  return (
    <LayoutContext.Provider
      value={{
        hideRightPanel,
        setHideRightPanel,
        chatOpen,
        setChatOpen,
        toggleChat,
        sidebarCollapsed,
        setSidebarCollapsed,
        toggleSidebar,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
