import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { can, type AppRole, type Capability } from "@/lib/permissions";

export type Profile = {
  id: string;
  full_name: string;
  role: AppRole;
  department: string | null;
};

export type Session = {
  user: { id: string; email: string | null };
  profile: Profile;
};

/**
 * The authenticated user plus their profile, or null.
 * `cache()` keeps this to one round-trip per request even when several
 * server components ask for it.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  // getUser() revalidates the JWT with Supabase — do not trust getSession()
  // on the server, which only reads the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, department")
    .eq("id", user.id)
    .single();

  // An authed user with no profile row has no capabilities rather than crashing.
  if (!profile) return null;

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: profile as Profile,
  };
});

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export type Gate =
  | { allowed: true; session: Session }
  | { allowed: false; role: AppRole };

/**
 * Redirects to /login only when unauthenticated. For an authenticated user
 * lacking the capability it returns { allowed: false } so the caller can
 * render a blocked screen rather than silently bouncing.
 */
export async function requireCapability(capability: Capability): Promise<Gate> {
  const session = await requireUser();
  if (!can(session.profile.role, capability)) {
    return { allowed: false, role: session.profile.role };
  }
  return { allowed: true, session };
}
