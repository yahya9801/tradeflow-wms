"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { clientSchema } from "@/lib/schemas/client";

export type ClientActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
};

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

const nz = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const f = (formData: FormData, key: string) => formData.get(key) ?? undefined;

export async function saveClient(_prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = clientSchema.safeParse({
    name: f(formData, "name"),
    type: f(formData, "type"),
    country: f(formData, "country"),
    contact_name: f(formData, "contact_name"),
    email: f(formData, "email"),
    phone: f(formData, "phone"),
    currency: f(formData, "currency"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  const row = {
    name: v.name,
    type: v.type,
    country: nz(v.country),
    contact_name: nz(v.contact_name),
    email: nz(v.email),
    phone: nz(v.phone),
    currency: v.currency,
  };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("clients")
      .select("name, type, country, contact_name, email, phone, currency")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabase.from("clients").update(row).eq("id", id);
    if (error) return { error: error.message };
    await writeAudit("update", "client", id, { before, after: row });
  } else {
    const { data, error } = await supabase.from("clients").insert(row).select("id").single();
    if (error) return { error: error.message };
    await writeAudit("create", "client", data.id, { after: row });
  }

  revalidatePath("/clients");
  if (id) revalidatePath(`/clients/${id}`);
  return { error: null, ok: true };
}

/** Blocks deletion of a client that has lots or invoices, with a reason. */
export async function deleteClient(_prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing client." };

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", id).maybeSingle();

  const { count: lotCount } = await supabase
    .from("lots")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);
  const { count: invCount } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);

  if ((lotCount ?? 0) > 0 || (invCount ?? 0) > 0) {
    const parts: string[] = [];
    if ((lotCount ?? 0) > 0) parts.push(`${lotCount} lot${lotCount === 1 ? "" : "s"}`);
    if ((invCount ?? 0) > 0) parts.push(`${invCount} invoice${invCount === 1 ? "" : "s"}`);
    return {
      error: `${client?.name ?? "This client"} has ${parts.join(" and ")}. Reassign or remove those first.`,
    };
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("delete", "client", id, { before: { name: client?.name } });

  revalidatePath("/clients");
  return { error: null, ok: true };
}
