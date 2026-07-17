"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { recordPayment, type InvoiceActionState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record payment"}</Button>;
}

export function PaymentDialog({
  invoiceId,
  invoiceNo,
  currency,
  remaining,
}: {
  invoiceId: string;
  invoiceNo: string;
  currency: string;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(recordPayment, { error: null });
  useActionToast(state, { success: "Payment recorded" });
  const [amount, setAmount] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={remaining <= 0}>Pay</Button>} />
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Record payment</DialogTitle>
        <DialogDescription>
          {invoiceNo} · remaining {currency} {remaining.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-amount" className={labelClass}>Amount</Label>
              <Input id="p-amount" name="amount" type="number" step="0.01" min="0" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              {state.fieldErrors?.amount ? <p className="text-xs text-destructive">{state.fieldErrors.amount}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-date" className={labelClass}>Date</Label>
              <Input id="p-date" name="paid_on" type="date" defaultValue={today} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-method" className={labelClass}>Method</Label>
            <Input id="p-method" name="method" placeholder="Wire, LC, cash…" />
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
