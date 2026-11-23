"use client";

import { createContext, useContext, useState } from "react";

// The transaction a selection was started from (detail "link to…"): it stays selected
// while filters hide it, so its counterpart can be searched for.
export type SelectionAnchor = { id: string; label: string; amount: number };

type SelectionModeState = {
  selecting: boolean;
  picked: Set<string>;
  anchor: SelectionAnchor | null;
  setSelecting: (on: boolean) => void;
  startFrom: (anchor: SelectionAnchor) => void;
  togglePicked: (id: string) => void;
};

const SelectionModeContext = createContext<SelectionModeState | null>(null);

// Shared by the list (row picking) and the mobile filter sheet (toggle), which are siblings.
export function SelectionModeProvider({ children }: { children: React.ReactNode }) {
  const [selecting, setMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);

  function setSelecting(on: boolean) {
    setMode(on);
    setPicked(new Set());
    setAnchor(null);
  }
  function startFrom(next: SelectionAnchor) {
    setMode(true);
    setPicked(new Set([next.id]));
    setAnchor(next);
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
    <SelectionModeContext.Provider
      value={{ selecting, picked, anchor, setSelecting, startFrom, togglePicked }}
    >
      {children}
    </SelectionModeContext.Provider>
  );
}

export function useSelectionMode(): SelectionModeState {
  const ctx = useContext(SelectionModeContext);
  if (!ctx) throw new Error("useSelectionMode must be used inside <SelectionModeProvider>");
  return ctx;
}
