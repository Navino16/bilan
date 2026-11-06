"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROW_LINK } from "./bits";

// List items past a card's cap, shown on demand; renders `<li>`s, to be placed inside a list.
export function ShowAll({
  children,
  label,
  lessLabel,
}: {
  children: ReactNode;
  label: string;
  lessLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && children}
      <li className="col-span-full">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn("text-primary flex items-center gap-1 text-[12.5px] font-medium", ROW_LINK)}
        >
          {open ? lessLabel : label}
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
          />
        </button>
      </li>
    </>
  );
}
