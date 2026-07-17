"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { preferencesSchema } from "@/lib/schemas/preferences";

export type PrefActionState = { error: string | null; fieldErrors?: Record<string, string>; ok?: boolean };

export async function savePreferences(_prev: PrefActionState, formData: FormData): Promise<PrefActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = preferencesSchema.safeParse({
    default_currency: formData.get("default_currency"),
    date_format: formData.get("date_format"),
    low_stock_threshold_pct: formData.get("low_stock_threshold_pct"),
    overdue_invoices: formData.get("overdue_invoices") === "on",
    over_capacity: formData.get("over_capacity") === "on",
    missing_bl: formData.get("missing_bl") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) { const k = String(i.path[0] ?? ""); if (k && !fieldErrors[k]) fieldErrors[k] = i.message; }
    return { error: null, fieldErrors };
  }

  const v = parsed.data;
  const rows = [
    { key: "default_currency", value: v.default_currency },
    { key: "date_format", value: v.date_format },
    { key: "low_stock_threshold_pct", value: v.low_stock_threshold_pct },
    { key: "alerts", value: { overdue_invoices: v.overdue_invoices, over_capacity: v.over_capacity, missing_bl: v.missing_bl } },
  ];

  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) return { error: error.message };

  await writeAudit("update", "settings", "preferences", { after: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  revalidatePath("/settings/preferences");
  revalidatePath("/dashboard");
  revalidatePath("/live-ops");
  return { error: null, ok: true };
}
