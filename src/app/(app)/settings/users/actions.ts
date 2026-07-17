"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { type AppRole } from "@/lib/permissions";
import { ROLES } from "./roles";

export type UserActionState = { error: string | null; ok?: boolean };

export async function saveUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  const active = formData.get("active") === "on";
  if (!id || !ROLES.includes(role)) return { error: "Pick a valid role." };

  // Self-guard: don't let an owner lock themselves out.
  if (id === gate.session.user.id && (!active || role !== "owner")) {
    return { error: "You can't change your own role or deactivate yourself." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("role, active").eq("id", id).maybeSingle();
  const { error } = await supabase.from("profiles").update({ role, active }).eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("update", "user", id, { before, after: { role, active } });
  revalidatePath("/settings/users");
  return { error: null, ok: true };
}
