"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCompany, type CompanyActionState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";
import type { Company } from "@/lib/company";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>;
}

export function CompanyForm({ company }: { company: Company }) {
  const [state, formAction] = useActionState<CompanyActionState, FormData>(saveCompany, { error: null });
  useActionToast(state, { success: "Company info saved" });
  const regs = Object.entries(company.registrations);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field name="name" label="Company name" defaultValue={company.name} required />
      <Field name="address" label="Address" defaultValue={company.address ?? ""} />
      <Field name="port" label="Port" defaultValue={company.port ?? ""} />
      <Field name="fiscal_year_start" label="Fiscal year start" type="date" defaultValue={company.fiscal_year_start ?? ""} />

      <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-4">
        <span className={labelClass}>Registrations (admin-locked)</span>
        {regs.length === 0 ? (
          <span className="text-sm text-muted-foreground">None on file.</span>
        ) : (
          <dl className="flex flex-col gap-1">
            {regs.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : state.ok ? (
        <p className="text-sm text-[#0f9d8c]">Saved.</p>
      ) : null}

      <div className="flex justify-end"><SubmitButton /></div>
    </form>
  );
}

function Field({ name, label, defaultValue, type, required }: { name: string; label: string; defaultValue: string; type?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`c-${name}`} className={labelClass}>{label}</Label>
      <Input id={`c-${name}`} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}
