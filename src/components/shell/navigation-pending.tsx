"use client";

import { createContext, use, useMemo, useTransition, type TransitionStartFunction } from "react";
import { cn } from "@/lib/utils";

type NavigationPendingValue = { pending: boolean; startNavigation: TransitionStartFunction };

const NavigationPendingContext = createContext<NavigationPendingValue | null>(null);

// Same-route navigations (period, filters) keep the old page on screen until the server
// answers; this region dims and reports aria-busy meanwhile. No loading.tsx: under Next
// 16.2 it drops early input events and stalls router.refresh() after mutations (#173).
export function NavigationPending({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [pending, startNavigation] = useTransition();
  const value = useMemo(() => ({ pending, startNavigation }), [pending, startNavigation]);

  return (
    <NavigationPendingContext value={value}>
      {pending && (
        <div
          aria-hidden
          data-slot="navigation-progress"
          className="bg-primary fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse motion-reduce:animate-none"
        />
      )}
      <div
        aria-busy={pending || undefined}
        data-pending={pending ? "" : undefined}
        className={cn(
          "transition-opacity",
          pending ? "opacity-60 delay-150 duration-200" : "duration-150",
          className,
        )}
      >
        {children}
      </div>
    </NavigationPendingContext>
  );
}

export function useNavigationTransition(): [boolean, TransitionStartFunction] {
  const shared = use(NavigationPendingContext);
  const local = useTransition();
  return shared ? [shared.pending, shared.startNavigation] : local;
}
