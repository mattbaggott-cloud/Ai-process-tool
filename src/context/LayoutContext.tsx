"use client";

import { createContext, useContext, useState } from "react";

interface LayoutContextValue {
  hideRightPanel: boolean;
  setHideRightPanel: (hide: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  hideRightPanel: false,
  setHideRightPanel: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
});

export function useLayout() {
  return useContext(LayoutContext);
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [hideRightPanel, setHideRightPanel] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  return (
    <LayoutContext.Provider
      value={{
        hideRightPanel,
        setHideRightPanel,
        sidebarCollapsed,
        setSidebarCollapsed,
        toggleSidebar,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
