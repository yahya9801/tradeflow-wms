"use client";

import type { ReactNode } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/components/session-provider";
import { DevUserSwitcher } from "@/components/layout/dev-user-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { signOut } from "@/app/login/actions";
import type { AppRole } from "@/lib/permissions";

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  management: "Management",
  finance: "Finance",
  warehouse: "Warehouse",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Top bar: the `leftSlot` carries the mobile nav trigger; the right side is
 * the real signed-in user, read from the server-provided session.
 */
export function TopBar({ leftSlot }: { leftSlot?: ReactNode }) {
  const session = useSession();
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {leftSlot}
      <div className="flex-1" />

      {isDev ? <DevUserSwitcher /> : null}
      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials(session.fullName)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{session.fullName}</span>
              <span className="hidden rounded-full bg-muted px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground md:inline">
                {ROLE_LABELS[session.role]}
              </span>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:inline" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            {/* Base UI: GroupLabel must live inside a Group. */}
            <DropdownMenuLabel className="flex flex-col">
              <span>{session.fullName}</span>
              <span className="text-xs font-normal text-muted-foreground">{session.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
