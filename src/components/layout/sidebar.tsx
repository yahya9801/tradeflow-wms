"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package } from "lucide-react";

import { cn } from "@/lib/utils";
import { navGroups } from "@/lib/nav";
import { usePermissions } from "@/components/session-provider";

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The navigation rail. Rendered directly for the desktop sidebar and reused
 * inside the mobile drawer. `onNavigate` lets the drawer close on selection.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = usePermissions();

  // Cosmetic only — the server gates each route regardless of what's shown.
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => can(item.capability)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col gap-1">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-4"
      >
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Package className="size-5" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold">TradeFlow</span>
          <span className="text-xs text-muted-foreground">WMS</span>
        </div>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
