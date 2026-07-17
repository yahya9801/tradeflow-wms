"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export type CompanyActionState = { error: string | null; ok?: boolean };

const nz = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s ? s : null; };

export async function saveCompany(_prev: CompanyActionState, formData: FormData): Promise<CompanyActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Company name is required." };

  // registrations is admin-locked — never written here.
  const patch = {
    name,
    address: nz(formData.get("address")),
    port: nz(formData.get("port")),
    fiscal_year_start: nz(formData.get("fiscal_year_start")),
  };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("companies_profile")
    .select("name, address, port, fiscal_year_start")
    .eq("id", true)
    .maybeSingle();
  const { error } = await supabase.from("companies_profile").update(patch).eq("id", true);
  if (error) return { error: error.message };

  await writeAudit("update", "company", "profile", { before, after: patch });
  revalidatePath("/settings/company");
  return { error: null, ok: true };
}
