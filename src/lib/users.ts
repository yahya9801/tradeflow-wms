import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/permissions";

export type UserRow = {
  id: string; full_name: string; role: AppRole; department: string | null; active: boolean;
};

export async function listProfiles(): Promise<UserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, active")
    .order("full_name");
  if (error) throw new Error(`listProfiles: ${error.message}`);
  return (data ?? []) as UserRow[];
}
