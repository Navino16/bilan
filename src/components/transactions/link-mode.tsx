"use client";

import { createContext, useContext, useState } from "react";

type LinkModeState = {
  linkMode: boolean;
  picked: Set<string>;
  setLinkMode: (on: boolean) => void;
  togglePicked: (id: string) => void;
};

const LinkModeContext = createContext<LinkModeState | null>(null);

// Shared by the list (row picking) and the mobile filter sheet (toggle), which are siblings.
export function LinkModeProvider({ children }: { children: React.ReactNode }) {
  const [linkMode, setMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function setLinkMode(on: boolean) {
    setMode(on);
    setPicked(new Set());
  }
  function togglePicked(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <LinkModeContext.Provider value={{ linkMode, picked, setLinkMode, togglePicked }}>
      {children}
    </LinkModeContext.Provider>
  );
}

export function useLinkMode(): LinkModeState {
  const ctx = useContext(LinkModeContext);
  if (!ctx) throw new Error("useLinkMode must be used inside <LinkModeProvider>");
  return ctx;
}
