"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveClient, type ClientActionState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass =
  "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Client = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create client"}
    </Button>
  );
}

export function ClientDialog({ client }: { client?: Client }) {
  const isEdit = Boolean(client);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ClientActionState, FormData>(saveClient, { error: null });
  useActionToast(state, { success: isEdit ? "Client updated" : "Client created" });

  // Controlled inputs: React 19 resets an uncontrolled form after the action
  // completes, wiping the user's values on a validation error.
  const [name, setName] = useState(client?.name ?? "");
  const [type, setType] = useState(client?.type ?? "buyer");
  const [country, setCountry] = useState(client?.country ?? "");
  const [contact, setContact] = useState(client?.contact_name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [currency, setCurrency] = useState(client?.currency ?? "USD");

  // Close only on a successful save; errors keep the Dialog open with values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "outline" : "default"} size="sm" className="gap-1.5">
            {isEdit ? (
              "Edit"
            ) : (
              <>
                <Plus className="size-4" />
                New client
              </>
            )}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? "Edit client" : "New client"}</DialogTitle>
        <DialogDescription>A buyer, supplier, or both — used across lots and invoices.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          {client ? <input type="hidden" name="id" value={client.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name" className={labelClass}>
              Name
            </Label>
            <Input id="c-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
            {state.fieldErrors?.name ? <p className="text-xs text-destructive">{state.fieldErrors.name}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-type" className={labelClass}>
                Type
              </Label>
              <select id="c-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                <option value="buyer">Buyer</option>
                <option value="supplier">Supplier</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-currency" className={labelClass}>
                Currency
              </Label>
              <select
                id="c-currency"
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={selectClass}
              >
                {["USD", "EUR", "GBP", "AED"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-country" className={labelClass}>
              Country
            </Label>
            <Input id="c-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-contact" className={labelClass}>
              Contact name
            </Label>
            <Input id="c-contact" name="contact_name" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-email" className={labelClass}>
                Email
              </Label>
              <Input id="c-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {state.fieldErrors?.email ? (
                <p className="text-xs text-destructive">{state.fieldErrors.email}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-phone" className={labelClass}>
                Phone
              </Label>
              <Input id="c-phone" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton isEdit={isEdit} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
