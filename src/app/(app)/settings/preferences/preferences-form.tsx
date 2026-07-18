"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePreferences, type PrefActionState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";
import { CURRENCIES, DATE_FORMATS } from "@/lib/schemas/preferences";
import type { Preferences } from "@/lib/preferences";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass = "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save preferences"}</Button>;
}

const TOGGLES: { key: "overdue_invoices" | "over_capacity" | "missing_bl"; label: string }[] = [
  { key: "overdue_invoices", label: "Overdue invoice alerts" },
  { key: "over_capacity", label: "Over-capacity alerts" },
  { key: "missing_bl", label: "Missing B/L alerts" },
];

export function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const [state, formAction] = useActionState<PrefActionState, FormData>(savePreferences, { error: null });
  useActionToast(state, { success: "Preferences saved" });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-cur" className={labelClass}>Default currency</Label>
          <select id="p-cur" name="default_currency" defaultValue={prefs.default_currency} className={selectClass}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-fmt" className={labelClass}>Date format</Label>
          <select id="p-fmt" name="date_format" defaultValue={prefs.date_format} className={selectClass}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="p-thr" className={labelClass}>Low-capacity threshold (%)</Label>
        <Input id="p-thr" name="low_stock_threshold_pct" type="number" min="1" max="100" defaultValue={prefs.low_stock_threshold_pct} className="max-w-32" />
        {state.fieldErrors?.low_stock_threshold_pct ? <p className="text-xs text-destructive">{state.fieldErrors.low_stock_threshold_pct}</p> : null}
        <p className="text-xs text-muted-foreground">Storing a lot past this occupancy raises a low-capacity exception.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <span className={labelClass}>Alert types</span>
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={t.key} defaultChecked={prefs.alerts[t.key]} />
            {t.label}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Unchecked types are hidden from the Action Center and Live Ops.</p>
      </fieldset>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : state.ok ? (
        <p className="text-sm text-[#0f9d8c]">Saved.</p>
      ) : null}

      <div className="flex justify-end"><SubmitButton /></div>
    </form>
  );
}
