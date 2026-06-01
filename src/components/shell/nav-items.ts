import { ArrowRightLeft, LayoutDashboard, Settings, ShieldCheck, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  /** Translation key under `shell.nav`. */
  key: string;
  /** Locale-less base path; components prefix with the active locale. */
  href: string;
  icon: LucideIcon;
  /** When set, the item only renders if the user holds this permission. */
  permission?: string;
};

/** Primary destinations — the "Espace" group in the design. */
export const WORKSPACE_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "transactions", href: "/transactions", icon: ArrowRightLeft },
  { key: "budgets", href: "/budgets", icon: Target },
];

/** Account-level destinations — the "Compte" group in the design. */
export const ACCOUNT_NAV: NavItem[] = [
  { key: "settings", href: "/settings", icon: Settings },
  { key: "admin", href: "/admin", icon: ShieldCheck, permission: "admin.settings.write" },
];

/** Four primary tabs surfaced in the mobile bottom bar. */
export const BOTTOM_NAV: NavItem[] = [...WORKSPACE_NAV, ACCOUNT_NAV[0]];
