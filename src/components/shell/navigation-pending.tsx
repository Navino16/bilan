"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useOptimistic,
  useTransition,
  type TransitionStartFunction,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type NavigationPendingValue = {
  pending: boolean;
  startNavigation: TransitionStartFunction;
  /** The pathname being navigated to while pending, else the current one. */
  targetPathname: string;
  navigate: (href: string) => void;
};

const NavigationPendingContext = createContext<NavigationPendingValue | null>(null);

// One transition shared by the shell nav links and the in-page period/filter controls, so
// their navigations show the progress bar and dim <NavigationPending>. No loading.tsx:
// under Next 16.2 it drops early input events and stalls router.refresh() (#173).
export function NavigationPendingProvider({ children }: { children: React.ReactNode }) {
  const [pending, startNavigation] = useTransition();
  const router = useRouter();
  const [targetPathname, setOptimisticPathname] = useOptimistic(usePathname());

  const navigate = useCallback(
    (href: string) =>
      startNavigation(() => {
        setOptimisticPathname(new URL(href, window.location.href).pathname);
        router.push(href);
      }),
    [router, setOptimisticPathname],
  );

  const value = useMemo(
    () => ({ pending, startNavigation, targetPathname, navigate }),
    [pending, targetPathname, navigate],
  );

  return (
    <NavigationPendingContext value={value}>
      {pending && (
        <div
          aria-hidden
          data-slot="navigation-progress"
          className="bg-primary fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse motion-reduce:animate-none"
        />
      )}
      {children}
    </NavigationPendingContext>
  );
}

// The region that keeps the old page on screen, dimmed and aria-busy, until the server answers.
export function NavigationPending({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pending = use(NavigationPendingContext)?.pending ?? false;
  return (
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
  );
}

export function useNavigationTransition(): [boolean, TransitionStartFunction] {
  const shared = use(NavigationPendingContext);
  const local = useTransition();
  return shared ? [shared.pending, shared.startNavigation] : local;
}

// For <Link>s in the shell: `pathname` is the committed one (drives aria-current), `targetPathname`
// the one being navigated to. `onNavigateTo(href)` keeps the real href (new tab, cmd-click) and
// routes plain clicks through the shared transition.
export function usePendingNavigation(): {
  pathname: string;
  targetPathname: string;
  onNavigateTo: (href: string) => ((event: { preventDefault: () => void }) => void) | undefined;
} {
  const shared = use(NavigationPendingContext);
  const pathname = usePathname();
  if (!shared) return { pathname, targetPathname: pathname, onNavigateTo: () => undefined };
  return {
    pathname,
    targetPathname: shared.targetPathname,
    onNavigateTo: (href) => (event) => {
      event.preventDefault();
      shared.navigate(href);
    },
  };
}
