import {
  ArrowRightLeft,
  Landmark,
  LayoutDashboard,
  ShieldCheck,
  Tags,
  Upload,
  Users,
} from "lucide-react";
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
  { key: "import", href: "/import", icon: Upload },
  { key: "accounts", href: "/accounts", icon: Landmark },
  { key: "categories", href: "/categories", icon: Tags },
  { key: "groups", href: "/groups", icon: Users },
];

/**
 * Account-level destinations — the "Compte" group in the design. The user
 * preferences page (/settings) is not built yet, so it stays out of the nav
 * until it ships (see PLAN.md); a link to it would 404.
 */
export const ACCOUNT_NAV: NavItem[] = [
  { key: "admin", href: "/admin", icon: ShieldCheck, permission: "admin.settings.write" },
];

/**
 * Five primary tabs surfaced in the mobile bottom bar. Kept explicit (not derived
 * from WORKSPACE_NAV) so secondary destinations like "groups"/admin stay out of
 * the bottom bar and live only in the left drawer / sidebar.
 */
export const BOTTOM_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "transactions", href: "/transactions", icon: ArrowRightLeft },
  { key: "import", href: "/import", icon: Upload },
  { key: "accounts", href: "/accounts", icon: Landmark },
  { key: "categories", href: "/categories", icon: Tags },
];
