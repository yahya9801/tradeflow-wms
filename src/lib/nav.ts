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

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Single source of truth for navigation. The sidebar (desktop) and the
 * mobile bottom tab bar both derive from this, so the module grouping in
 * CLAUDE.md §1 lives in exactly one place.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Live Ops", href: "/live-ops", icon: Radar },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { title: "Warehouses", href: "/warehouses", icon: Warehouse },
      { title: "Lots", href: "/lots", icon: Boxes },
    ],
  },
  {
    label: "Trade",
    items: [
      { title: "Imports", href: "/imports", icon: ArrowDownToLine },
      { title: "Exports", href: "/exports", icon: ArrowUpFromLine },
      { title: "Clients", href: "/clients", icon: Users },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Accounts", href: "/accounts", icon: Wallet },
      { title: "Reports", href: "/reports", icon: BarChart3 },
      { title: "Audit Log", href: "/audit", icon: ScrollText },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Users & Roles", href: "/settings/users", icon: UsersRound },
      { title: "Company Info", href: "/settings/company", icon: Building2 },
      { title: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
    ],
  },
];

/** Flattened list of all nav items, handy for lookups. */
export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

/**
 * Mobile bottom tab bar — one representative destination per module group,
 * kept to five so touch targets stay comfortable on a phone.
 */
export const bottomNavItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Lots", href: "/lots", icon: Boxes },
  { title: "Clients", href: "/clients", icon: Users },
  { title: "Accounts", href: "/accounts", icon: Wallet },
  { title: "Settings", href: "/settings/users", icon: SlidersHorizontal },
];
