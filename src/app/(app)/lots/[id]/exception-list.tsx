"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveException, type LotActionState } from "../actions";
import type { LotException } from "@/lib/lots";

const SEVERITY: Record<string, { cls: string; label: string }> = {
  critical: { cls: "bg-[#d03b3b]/10 text-[#d03b3b]", label: "Critical" },
  warning: { cls: "bg-[#fab219]/15 text-[#8a5d00] dark:text-[#fab219]", label: "Warning" },
  notice: { cls: "bg-muted text-muted-foreground", label: "Notice" },
};

const TYPE_LABELS: Record<string, string> = {
  weight_shortage: "Weight shortage",
  missing_bl: "Missing B/L",
  missing_payment_terms: "Missing payment terms",
  compliance_block: "Compliance block",
  overdue_invoice: "Overdue invoice",
  low_capacity: "Low capacity",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Resolving…" : "Resolve"}
    </Button>
  );
}

export function ExceptionList({
  lotId,
  exceptions,
  canResolve,
}: {
  lotId: string;
  exceptions: LotException[];
  canResolve: boolean;
}) {
  const open = exceptions.filter((e) => e.status === "open");
  const resolved = exceptions.filter((e) => e.status === "resolved");

  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">No exceptions</p>
        <p className="mt-1 text-sm text-muted-foreground">Nothing is flagged against this lot.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {open.map((e) => (
        <ExceptionCard key={e.id} lotId={lotId} exception={e} canResolve={canResolve} />
      ))}
      {resolved.map((e) => (
        <div key={e.id} className="rounded-xl border bg-muted/30 p-4 opacity-70">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{TYPE_LABELS[e.type] ?? e.type}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Resolved</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
          {e.note ? <p className="mt-2 text-xs text-muted-foreground">Note: {e.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ExceptionCard({
  lotId,
  exception,
  canResolve,
}: {
  lotId: string;
  exception: LotException;
  canResolve: boolean;
}) {
  const [state, formAction] = useActionState<LotActionState, FormData>(resolveException, { error: null });
  const [note, setNote] = useState("");
  const sev = SEVERITY[exception.severity] ?? SEVERITY.notice;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{TYPE_LABELS[exception.type] ?? exception.type}</span>
            {/* Icon+label, never colour alone. */}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", sev.cls)}>
              {sev.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{exception.description}</p>
        </div>
      </div>

      {canResolve ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={exception.id} />
          <input type="hidden" name="lot_id" value={lotId} />
          <div className="flex gap-2">
            <Input
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How was this resolved?"
              className="h-9"
            />
            <SubmitButton />
          </div>
          {state.fieldErrors?.note ? (
            <p className="text-xs text-destructive">{state.fieldErrors.note}</p>
          ) : null}
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
