"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { warehouseSchema, shedSchema } from "@/lib/schemas/warehouse";

export type ActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  /** Set only on a successful write; the Dialogs close on this. */
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

export async function saveWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = warehouseSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    capacity_mt: formData.get("capacity_mt"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("warehouses")
      .select("name, address, capacity_mt")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("warehouses").update(parsed.data).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "warehouse", id, { before, after: parsed.data });
  } else {
    const { data, error } = await supabase.from("warehouses").insert(parsed.data).select("id").single();
    if (error) return { error: error.message };

    await writeAudit("create", "warehouse", data.id, { after: parsed.data });
  }

  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

export async function saveShed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = shedSchema.safeParse({
    name: formData.get("name"),
    capacity_mt: formData.get("capacity_mt"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const id = String(formData.get("id") ?? "");
  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!warehouseId) return { error: "Missing warehouse." };

  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("sheds")
      .select("name, capacity_mt")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("sheds").update(parsed.data).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "shed", id, { before, after: parsed.data });
  } else {
    const { data, error } = await supabase
      .from("sheds")
      .insert({ ...parsed.data, warehouse_id: warehouseId })
      .select("id")
      .single();
    if (error) return { error: error.message };

    await writeAudit("create", "shed", data.id, { after: { ...parsed.data, warehouse_id: warehouseId } });
  }

  revalidatePath(`/warehouses/${warehouseId}`);
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

/**
 * Refuses to delete a shed that holds lots or has history, with a reason.
 * Trade records are never silently destroyed.
 */
export async function deleteShed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!id) return { error: "Missing shed." };

  const supabase = await createClient();

  const { data: shed } = await supabase.from("sheds").select("name").eq("id", id).maybeSingle();

  const { count: storedCount } = await supabase
    .from("lots")
    .select("*", { count: "exact", head: true })
    .eq("shed_id", id)
    .eq("status", "stored");

  const { count: historyCount } = await supabase
    .from("lot_movements")
    .select("*", { count: "exact", head: true })
    .eq("shed_id", id);

  if ((storedCount ?? 0) > 0 || (historyCount ?? 0) > 0) {
    const parts: string[] = [];
    if ((storedCount ?? 0) > 0) parts.push(`${storedCount} stored lot${storedCount === 1 ? "" : "s"}`);
    if ((historyCount ?? 0) > 0)
      parts.push(`${historyCount} historical record${historyCount === 1 ? "" : "s"}`);
    return {
      error: `${shed?.name ?? "This shed"} holds ${parts.join(" and ")}. Move them before deleting.`,
    };
  }

  const { error } = await supabase.from("sheds").delete().eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("delete", "shed", id, { before: { name: shed?.name } });

  revalidatePath(`/warehouses/${warehouseId}`);
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}
