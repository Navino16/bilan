"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FADE = "1.5rem";

// Active item = [aria-current=page] | [aria-pressed=true]; scrolled into view on mount only.
export function ScrollFade({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"]');
    if (active) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    const sync = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", sync, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", sync);
    };
  }, []);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${FADE}, black calc(100% - ${FADE}), ${edges.right ? "transparent" : "black"})`;
  return (
    <div
      ref={ref}
      className={cn(
        "relative [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
