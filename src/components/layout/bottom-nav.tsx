"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { bottomNavItems } from "@/lib/nav";
import { isActive } from "@/components/layout/sidebar";
import { usePermissions } from "@/components/session-provider";

/** Mobile-only bottom tab bar. Hidden from `md` upward, where the sidebar takes over. */
export function BottomNav() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const visibleItems = bottomNavItems.filter((item) => can(item.capability));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      {visibleItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-5" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
