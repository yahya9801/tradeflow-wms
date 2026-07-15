"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { lotFormToInput, lotSchema } from "@/lib/schemas/lot";

export type LotActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
  lotId?: string;
};

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Empty string → NULL, so optional columns stay null rather than "". */
const nz = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export async function saveLot(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to edit lots." };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  // Status is NEVER read from the form. A client could post status=pending on
  // an in-transit import to dodge the B/L requirement — defeating the rule this
  // phase exists to enforce. New lots are pending by definition; edits use
  // whatever the database currently says.
  let currentStatus = "pending";
  if (id) {
    const { data: existing } = await supabase
      .from("lots")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { error: "Lot not found." };
    currentStatus = existing.status;
  }

  const parsed = lotSchema.safeParse(lotFormToInput(formData, currentStatus));
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  const row = {
    direction: v.direction,
    commodity_id: v.commodity_id,
    client_id: v.client_id,
    quantity_mt: v.quantity_mt,
    origin_country: nz(v.origin_country),
    destination_country: nz(v.destination_country),
    vessel_name: nz(v.vessel_name),
    bl_number: nz(v.bl_number),
    export_ref: nz(v.export_ref),
    payment_terms: v.payment_terms ? v.payment_terms : null,
    eta: nz(v.eta),
    notes: nz(v.notes),
  };

  if (id) {
    const { data: before } = await supabase.from("lots").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("lots").update(row).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "lot", id, { before, after: row });
    await autoResolveFieldExceptions(id, gate.session.user.id);

    revalidatePath(`/lots/${id}`);
    revalidatePath("/lots");
    return { error: null, ok: true, lotId: id };
  }

  const { data, error } = await supabase
    .from("lots")
    .insert({ ...row, status: "pending", created_by: gate.session.user.id })
    .select("id, lot_number")
    .single();
  if (error) return { error: error.message };

  await writeAudit("create", "lot", data.id, { after: { ...row, lot_number: data.lot_number } });

  revalidatePath("/lots");
  return { error: null, ok: true, lotId: data.id };
}

/**
 * CLAUDE.md: "Resolving = filling the field or explicitly resolving with a
 * note." So filling a B/L closes an open missing_bl, and setting payment terms
 * closes an open missing_payment_terms.
 */
export async function autoResolveFieldExceptions(lotId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("lots")
    .select("bl_number, payment_terms")
    .eq("id", lotId)
    .maybeSingle();
  if (!lot) return;

  const nowResolved: string[] = [];
  if (lot.bl_number) nowResolved.push("missing_bl");
  if (lot.payment_terms) nowResolved.push("missing_payment_terms");
  if (nowResolved.length === 0) return;

  const { data: closed } = await supabase
    .from("exceptions")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      note: "Automatically resolved: the missing field was filled in.",
    })
    .eq("lot_id", lotId)
    .eq("status", "open")
    .in("type", nowResolved)
    .select("id, type");

  for (const e of closed ?? []) {
    await writeAudit("resolve", "exception", e.id, { type: e.type, auto: true, lot_id: lotId });
  }
}
