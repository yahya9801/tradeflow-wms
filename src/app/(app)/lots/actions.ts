"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { lotFormToInput, lotSchema } from "@/lib/schemas/lot";
import { allowedTransitions, type LotStatus } from "@/lib/lot-status";

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

/**
 * The database trigger is the enforcement mechanism; this check exists to give
 * a clean message and to stop an illegal move before it reaches SQL.
 */
export async function transitionLot(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to change lot status." };

  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as LotStatus;
  const shedId = String(formData.get("shed_id") ?? "");
  if (!id || !to) return { error: "Missing lot or target status." };

  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("lots")
    .select("id, lot_number, status, direction, bl_number, quantity_mt, shed_id, warehouse_id")
    .eq("id", id)
    .maybeSingle();
  if (!lot) return { error: "Lot not found." };

  const isOwner = gate.session.profile.role === "owner";
  if (!allowedTransitions(lot.status as LotStatus, isOwner).includes(to)) {
    return { error: `${lot.lot_number} cannot move from ${lot.status} to ${to}.` };
  }

  // CLAUDE.md: an import in transit must have its B/L recorded.
  if (to === "in_transit" && lot.direction === "import" && !lot.bl_number) {
    return { error: "Record the B/L number before marking this import in transit." };
  }

  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };

  if (to === "stored") {
    if (!shedId) return { error: "Choose a shed to store this lot in." };
    const { data: shed } = await supabase
      .from("sheds")
      .select("id, warehouse_id")
      .eq("id", shedId)
      .maybeSingle();
    if (!shed) return { error: "That shed no longer exists." };
    patch.shed_id = shedId;
    patch.warehouse_id = shed.warehouse_id;
    patch.arrival_date = patch.arrival_date ?? new Date().toISOString().slice(0, 10);
  }
  if (to === "dispatched") patch.dispatch_date = new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("lots").update(patch).eq("id", id);
  if (error) {
    // The trigger's message is written for humans — surface it as-is rather
    // than a raw Postgres error.
    return { error: error.message.replace(/^.*?violates.*?:\s*/i, "") };
  }

  await writeAudit("transition", "lot", id, { from: lot.status, to, shed_id: shedId || null });

  revalidatePath(`/lots/${id}`);
  revalidatePath("/lots");
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

export async function resolveException(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to resolve exceptions." };

  const id = String(formData.get("id") ?? "");
  const lotId = String(formData.get("lot_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: null, fieldErrors: { note: "Add a note explaining the resolution." } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exceptions")
    .update({
      status: "resolved",
      note,
      resolved_by: gate.session.user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("resolve", "exception", id, { note, auto: false, lot_id: lotId });

  revalidatePath(`/lots/${lotId}`);
  return { error: null, ok: true };
}
