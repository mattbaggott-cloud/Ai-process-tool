"use client";

import { createContext, useContext, useState } from "react";

interface LayoutContextValue {
  hideRightPanel: boolean;
  setHideRightPanel: (hide: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  hideRightPanel: false,
  setHideRightPanel: () => {},
});

export function useLayout() {
  return useContext(LayoutContext);
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [hideRightPanel, setHideRightPanel] = useState(false);
  return (
    <LayoutContext.Provider value={{ hideRightPanel, setHideRightPanel }}>
      {children}
    </LayoutContext.Provider>
  );
}
