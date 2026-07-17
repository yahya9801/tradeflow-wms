"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronRight, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOT_STATUSES, STATUS_LABELS, statusIndex, type LotStatus } from "@/lib/lot-status";
import { transitionLot, type LotActionState } from "../actions";
import { useActionToast } from "@/lib/use-action-toast";

type Shed = { id: string; name: string; free_mt: number };
type Warehouse = { id: string; name: string; sheds: Shed[] };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Working…" : label}</Button>;
}

export function StatusStepper({
  lotId,
  current,
  transitions,
  warehouses,
}: {
  lotId: string;
  current: LotStatus;
  transitions: LotStatus[];
  warehouses: Warehouse[];
}) {
  const [state, formAction] = useActionState<LotActionState, FormData>(transitionLot, { error: null });
  useActionToast(state, { success: "Status updated" });
  const [storeOpen, setStoreOpen] = useState(false);
  const [shedId, setShedId] = useState("");
  const currentIdx = statusIndex(current);

  const forward = transitions.find((t) => statusIndex(t) > currentIdx);
  const back = transitions.find((t) => statusIndex(t) < currentIdx);

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-5">
      <ol className="flex flex-wrap items-center gap-1">
        {LOT_STATUSES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  active && "bg-primary text-primary-foreground",
                  done && "text-muted-foreground",
                  !active && !done && "text-muted-foreground/50",
                )}
              >
                {done ? <Check className="size-3" /> : null}
                {STATUS_LABELS[s]}
              </span>
              {i < LOT_STATUSES.length - 1 ? (
                <ChevronRight className="size-3 text-muted-foreground/40" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {transitions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {forward ? (
            forward === "stored" ? (
              <Button size="sm" onClick={() => setStoreOpen(true)}>
                Mark as Stored…
              </Button>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="id" value={lotId} />
                <input type="hidden" name="to" value={forward} />
                <SubmitButton label={`Mark as ${STATUS_LABELS[forward]}`} />
              </form>
            )
          ) : null}

          {back ? (
            <form action={formAction}>
              <input type="hidden" name="id" value={lotId} />
              <input type="hidden" name="to" value={back} />
              <Button type="submit" variant="outline" size="sm" className="gap-1.5">
                <Undo2 className="size-3.5" />
                Back to {STATUS_LABELS[back]}
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This lot has completed its lifecycle.</p>
      )}

      {/* Storing needs a destination, so this is the one transition that asks a
          question first. The DB trigger is still the backstop on capacity. */}
      <Dialog open={storeOpen} onOpenChange={setStoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Store this lot</DialogTitle>
          <DialogDescription>Choose a shed with room for it.</DialogDescription>
          <form action={formAction} className="mt-2 flex flex-col gap-4">
            <input type="hidden" name="id" value={lotId} />
            <input type="hidden" name="to" value="stored" />
            <select
              name="shed_id"
              value={shedId}
              onChange={(e) => setShedId(e.target.value)}
              className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              required
            >
              <option value="">Select a shed</option>
              {warehouses.map((w) => (
                <optgroup key={w.id} label={w.name}>
                  {w.sheds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.free_mt.toLocaleString("en-US")} MT free
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStoreOpen(false)}>
                Cancel
              </Button>
              <SubmitButton label="Store lot" />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
