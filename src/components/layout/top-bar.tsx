"use client";

import type { ReactNode } from "react";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";

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

/**
 * Top bar: the `leftSlot` carries the mobile nav trigger; the right side is
 * the user menu. The user shown is a placeholder until auth lands (Phase 2).
 */
export function TopBar({ leftSlot }: { leftSlot?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {leftSlot}
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">OW</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">Owner</span>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:inline" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            {/* Base UI requires GroupLabel (DropdownMenuLabel) to live inside a Group. */}
            <DropdownMenuLabel className="flex flex-col">
              <span>Signed in</span>
              <span className="text-xs font-normal text-muted-foreground">
                owner@tradeflow.example
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <UserRound className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Settings className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
