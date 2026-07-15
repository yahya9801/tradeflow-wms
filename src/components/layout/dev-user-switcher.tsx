"use client";

import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { devSignInAs } from "@/app/login/actions";

const TEST_USERS = [
  { email: "owner@tradeflow.example", label: "Ava Owner", role: "Owner" },
  { email: "management@tradeflow.example", label: "Marcus Manager", role: "Management" },
];

/**
 * Dev affordance — dashed border and flask icon so it never reads as product
 * chrome. The server action behind it hard-fails in production.
 */
export function DevUserSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-dashed text-muted-foreground"
          >
            <FlaskConical className="size-3.5" />
            <span className="hidden sm:inline">Dev</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {/* Base UI: GroupLabel must live inside a Group. */}
          <DropdownMenuLabel>Switch user (dev only)</DropdownMenuLabel>
        </DropdownMenuGroup>
        {TEST_USERS.map((user) => (
          <DropdownMenuItem key={user.email} onClick={() => devSignInAs(user.email)}>
            <span className="flex flex-col">
              <span>{user.label}</span>
              <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {user.role}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
