"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteInvoice, type InvoiceActionState } from "./actions";

export function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(deleteInvoice, { error: null });
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={invoiceId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        title={state.error ?? "Delete invoice"}
      >
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}
