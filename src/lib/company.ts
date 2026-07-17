import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Company = {
  name: string; address: string | null; port: string | null;
  fiscal_year_start: string | null; registrations: Record<string, unknown>;
};

export async function getCompany(): Promise<Company | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies_profile")
    .select("name, address, port, fiscal_year_start, registrations")
    .eq("id", true)
    .maybeSingle();
  if (!data) return null;
  return { ...data, registrations: (data.registrations ?? {}) as Record<string, unknown> };
}
