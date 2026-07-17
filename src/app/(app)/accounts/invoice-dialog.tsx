"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveInvoice, type InvoiceActionState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";
import type { Option } from "@/lib/finance";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass =
  "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoicePrefill = {
  id?: string;
  type?: "receivable" | "payable";
  client_id?: string;
  lot_id?: string | null;
  currency?: string;
  amount?: number;
  due_date?: string | null;
  description?: string | null;
};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create invoice"}
    </Button>
  );
}

export function InvoiceDialog({
  clients,
  lots,
  prefill,
  trigger,
}: {
  clients: Option[];
  lots: Option[];
  prefill?: InvoicePrefill;
  /** Custom trigger element; defaults to a "New invoice" button. */
  trigger?: React.ReactElement;
}) {
  const isEdit = Boolean(prefill?.id);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(saveInvoice, { error: null });
  useActionToast(state, { success: isEdit ? "Invoice updated" : "Invoice created" });

  const [type, setType] = useState<"receivable" | "payable">(prefill?.type ?? "receivable");
  const [clientId, setClientId] = useState(prefill?.client_id ?? "");
  const [lotId, setLotId] = useState(prefill?.lot_id ?? "");
  const [currency, setCurrency] = useState(prefill?.currency ?? "USD");
  const [amount, setAmount] = useState(prefill?.amount != null ? String(prefill.amount) : "");
  const [dueDate, setDueDate] = useState(prefill?.due_date ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              New invoice
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? "Edit invoice" : "New invoice"}</DialogTitle>
        <DialogDescription>Linked to a client, optionally to a lot.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          {prefill?.id ? <input type="hidden" name="id" value={prefill.id} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-type" className={labelClass}>Type</Label>
              <select
                id="i-type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as "receivable" | "payable")}
                className={selectClass}
              >
                <option value="receivable">Receivable (AR)</option>
                <option value="payable">Payable (AP)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-currency" className={labelClass}>Currency</Label>
              <select id="i-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}>
                {["USD", "EUR", "GBP", "AED"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-client" className={labelClass}>Client</Label>
            <select id="i-client" name="client_id" value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectClass} required>
              <option value="" disabled>Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {state.fieldErrors?.client_id ? <p className="text-xs text-destructive">{state.fieldErrors.client_id}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-lot" className={labelClass}>Lot (optional)</Label>
            <select id="i-lot" name="lot_id" value={lotId ?? ""} onChange={(e) => setLotId(e.target.value)} className={selectClass}>
              <option value="">None</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-amount" className={labelClass}>Amount</Label>
              <Input id="i-amount" name="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              {state.fieldErrors?.amount ? <p className="text-xs text-destructive">{state.fieldErrors.amount}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-due" className={labelClass}>Due date</Label>
              <Input id="i-due" name="due_date" type="date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-desc" className={labelClass}>Description</Label>
            <Input id="i-desc" name="description" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton isEdit={isEdit} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
