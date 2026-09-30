"use client";

import { createContext, useContext, useState } from "react";

type SelectionModeState = {
  selecting: boolean;
  picked: Set<string>;
  setSelecting: (on: boolean) => void;
  togglePicked: (id: string) => void;
};

const SelectionModeContext = createContext<SelectionModeState | null>(null);

// Shared by the list (row picking) and the mobile filter sheet (toggle), which are siblings.
export function SelectionModeProvider({ children }: { children: React.ReactNode }) {
  const [selecting, setMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function setSelecting(on: boolean) {
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
    <SelectionModeContext.Provider value={{ selecting, picked, setSelecting, togglePicked }}>
      {children}
    </SelectionModeContext.Provider>
  );
}

export function useSelectionMode(): SelectionModeState {
  const ctx = useContext(SelectionModeContext);
  if (!ctx) throw new Error("useSelectionMode must be used inside <SelectionModeProvider>");
  return ctx;
}
