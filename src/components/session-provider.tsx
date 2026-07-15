"use client";

import { createContext, useContext, type ReactNode } from "react";

import { can, type AppRole, type Capability } from "@/lib/permissions";

export type SessionValue = {
  userId: string;
  email: string | null;
  fullName: string;
  role: AppRole;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionValue;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}

/**
 * Cosmetic helper: hides what the user cannot use. The server already gated
 * the route and RLS already filtered the data — this is never the mechanism.
 */
export function usePermissions() {
  const session = useSession();
  return {
    role: session.role,
    can: (capability: Capability) => can(session.role, capability),
  };
}
