"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveShed, type ActionState } from "../actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Shed = { id: string; name: string; capacity_mt: number };

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add shed"}
    </Button>
  );
}

export function ShedDialog({ warehouseId, shed }: { warehouseId: string; shed?: Shed }) {
  const isEdit = Boolean(shed);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveShed, { error: null });

  // Controlled inputs: React 19 auto-resets an uncontrolled form once the action
  // completes, which would wipe what the user typed on a validation error.
  const [name, setName] = useState(shed?.name ?? "");
  const [capacity, setCapacity] = useState(shed?.capacity_mt?.toString() ?? "");

  // Close only on a successful save; errors keep the Dialog open with values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "ghost" : "default"} size="sm" className="gap-1.5">
            {isEdit ? (
              "Edit"
            ) : (
              <>
                <Plus className="size-4" />
                Add shed
              </>
            )}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? `Edit ${shed?.name}` : "Add shed"}</DialogTitle>
        <DialogDescription>Capacity in metric tonnes available for storage.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="warehouse_id" value={warehouseId} />
          {shed ? <input type="hidden" name="id" value={shed.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shed-name" className={labelClass}>
              Name
            </Label>
            <Input
              id="shed-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {state.fieldErrors?.name ? (
              <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shed-capacity" className={labelClass}>
              Capacity (MT)
            </Label>
            <Input
              id="shed-capacity"
              name="capacity_mt"
              type="number"
              step="1"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
            {state.fieldErrors?.capacity_mt ? (
              <p className="text-xs text-destructive">{state.fieldErrors.capacity_mt}</p>
            ) : null}
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
