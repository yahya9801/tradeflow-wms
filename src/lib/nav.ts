import {
  LayoutDashboard,
  Radar,
  Warehouse,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Wallet,
  BarChart3,
  ScrollText,
  UsersRound,
  Building2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import type { Capability } from "@/lib/permissions";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  capability: Capability;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Single source of truth for navigation. The sidebar (desktop) and the
 * mobile bottom tab bar both derive from this, so the module grouping in
 * CLAUDE.md §1 lives in exactly one place.
 *
 * `capability` drives cosmetic filtering only — the server gates the route
 * and RLS filters the data.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, capability: "view_operations" },
      { title: "Live Ops", href: "/live-ops", icon: Radar, capability: "view_operations" },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { title: "Warehouses", href: "/warehouses", icon: Warehouse, capability: "view_operations" },
      { title: "Lots", href: "/lots", icon: Boxes, capability: "view_operations" },
    ],
  },
  {
    label: "Trade",
    items: [
      { title: "Imports", href: "/imports", icon: ArrowDownToLine, capability: "view_operations" },
      { title: "Exports", href: "/exports", icon: ArrowUpFromLine, capability: "view_operations" },
      { title: "Clients", href: "/clients", icon: Users, capability: "view_operations" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Accounts", href: "/accounts", icon: Wallet, capability: "view_financials" },
      { title: "Reports", href: "/reports", icon: BarChart3, capability: "view_financials" },
      { title: "Audit Log", href: "/audit", icon: ScrollText, capability: "view_audit" },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Users & Roles", href: "/settings/users", icon: UsersRound, capability: "manage_users" },
      { title: "Company Info", href: "/settings/company", icon: Building2, capability: "manage_users" },
      {
        title: "Preferences",
        href: "/settings/preferences",
        icon: SlidersHorizontal,
        capability: "manage_users",
      },
    ],
  },
];

/** Flattened list of all nav items, handy for lookups. */
export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

/**
 * Mobile bottom tab bar — one representative destination per module group,
 * kept to five so touch targets stay comfortable on a phone. A Management
 * user sees three: showing tabs that lead to blocked screens would be worse.
 */
export const bottomNavItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, capability: "view_operations" },
  { title: "Lots", href: "/lots", icon: Boxes, capability: "view_operations" },
  { title: "Clients", href: "/clients", icon: Users, capability: "view_operations" },
  { title: "Accounts", href: "/accounts", icon: Wallet, capability: "view_financials" },
  { title: "Settings", href: "/settings/users", icon: SlidersHorizontal, capability: "manage_users" },
];
