"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveLot, type LotActionState } from "./actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Option = { id: string; name: string };
type Commodity = Option & { bag_weight_kg: number };

export type LotFormValues = {
  id?: string;
  direction: "import" | "export";
  status: string;
  commodity_id: string;
  client_id: string;
  quantity_mt: string;
  origin_country: string;
  destination_country: string;
  vessel_name: string;
  bl_number: string;
  export_ref: string;
  payment_terms: string;
  eta: string;
  notes: string;
};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create lot"}
    </Button>
  );
}

export function LotForm({
  commodities,
  clients,
  initial,
}: {
  commodities: Commodity[];
  clients: Option[];
  initial: LotFormValues;
}) {
  const isEdit = Boolean(initial.id);
  const router = useRouter();
  const [state, formAction] = useActionState<LotActionState, FormData>(saveLot, { error: null });

  // Controlled: React 19 resets an uncontrolled form once the action completes,
  // which would wipe everything the user typed on a validation error.
  const [v, setV] = useState<LotFormValues>(initial);
  const set = <K extends keyof LotFormValues>(k: K, val: LotFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  useEffect(() => {
    if (state.ok && state.lotId) router.push(`/lots/${state.lotId}`);
  }, [state, router]);

  // bags = quantity_mt * 1000 / bag_weight_kg — derived, shown live, never stored.
  const bags = useMemo(() => {
    const c = commodities.find((x) => x.id === v.commodity_id);
    const qty = Number(v.quantity_mt);
    if (!c || !Number.isFinite(qty) || qty <= 0 || !c.bag_weight_kg) return null;
    return Math.round((qty * 1000) / c.bag_weight_kg);
  }, [commodities, v.commodity_id, v.quantity_mt]);

  const isImport = v.direction === "import";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* No status field, hidden or otherwise: the server reads the lot's
          current status from the database. Sending it from here would let a
          client dodge the conditional B/L rule. */}
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="direction" value={v.direction} />

      <div className="flex items-center gap-1 rounded-lg border p-0.5 w-fit">
        {(["import", "export"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => set("direction", d)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm capitalize transition-colors",
              v.direction === d
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Commodity" error={state.fieldErrors?.commodity_id}>
          <select
            name="commodity_id"
            value={v.commodity_id}
            onChange={(e) => set("commodity_id", e.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            required
          >
            <option value="">Select a commodity</option>
            {commodities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Counterparty" error={state.fieldErrors?.client_id}>
          <select
            name="client_id"
            value={v.client_id}
            onChange={(e) => set("client_id", e.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            required
          >
            <option value="">Select a counterparty</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Quantity (MT)"
          error={state.fieldErrors?.quantity_mt}
          hint={bags != null ? `${bags.toLocaleString("en-US")} bags` : undefined}
        >
          <Input
            name="quantity_mt"
            type="number"
            step="0.001"
            min="0"
            value={v.quantity_mt}
            onChange={(e) => set("quantity_mt", e.target.value)}
            required
          />
        </Field>

        <Field label="ETA">
          <Input name="eta" type="date" value={v.eta} onChange={(e) => set("eta", e.target.value)} />
        </Field>

        {isImport ? (
          <>
            <Field label="Origin country">
              <Input
                name="origin_country"
                value={v.origin_country}
                onChange={(e) => set("origin_country", e.target.value)}
              />
            </Field>
            <Field label="Vessel">
              <Input
                name="vessel_name"
                value={v.vessel_name}
                onChange={(e) => set("vessel_name", e.target.value)}
              />
            </Field>
            <Field
              label="B/L number"
              error={state.fieldErrors?.bl_number}
              hint="Required once in transit"
            >
              <Input
                name="bl_number"
                value={v.bl_number}
                onChange={(e) => set("bl_number", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Destination country">
              <Input
                name="destination_country"
                value={v.destination_country}
                onChange={(e) => set("destination_country", e.target.value)}
              />
            </Field>
            <Field label="Export reference">
              <Input
                name="export_ref"
                value={v.export_ref}
                onChange={(e) => set("export_ref", e.target.value)}
              />
            </Field>
            <Field label="Payment terms" error={state.fieldErrors?.payment_terms}>
              <select
                name="payment_terms"
                value={v.payment_terms}
                onChange={(e) => set("payment_terms", e.target.value)}
                className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Select terms</option>
                {["LC", "TT", "CAD", "DA"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>

      <Field label="Notes">
        <Input name="notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <SubmitButton isEdit={isEdit} />
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className={labelClass}>{label}</Label>
        {hint ? <span className="font-mono text-[0.6875rem] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
