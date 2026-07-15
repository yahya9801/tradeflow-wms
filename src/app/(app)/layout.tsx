import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await requireUser();

  return (
    <AppShell
      session={{
        userId: user.id,
        email: user.email,
        fullName: profile.full_name,
        role: profile.role,
      }}
    >
      {children}
    </AppShell>
  );
}
