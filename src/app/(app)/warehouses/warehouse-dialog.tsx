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
import { saveWarehouse, type ActionState } from "./actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Warehouse = { id: string; name: string; address: string | null; capacity_mt: number };

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create warehouse"}
    </Button>
  );
}

export function WarehouseDialog({ warehouse }: { warehouse?: Warehouse }) {
  const isEdit = Boolean(warehouse);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveWarehouse, { error: null });

  // Controlled inputs: React 19 auto-resets an uncontrolled form once the
  // action completes, which would wipe what the user typed on a validation
  // error. Holding the values in state keeps them intact.
  const [name, setName] = useState(warehouse?.name ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [capacity, setCapacity] = useState(warehouse?.capacity_mt?.toString() ?? "");

  // Close only on a successful save. `state` gets a new identity on every action
  // result, so this fires per submission — never on a plain reopen — and an
  // error leaves the Dialog open with the user's values intact.
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
                New warehouse
              </>
            )}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? "Edit warehouse" : "New warehouse"}</DialogTitle>
        <DialogDescription>
          Rated capacity is the facility total. Sheds allocate part of it.
        </DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          {warehouse ? <input type="hidden" name="id" value={warehouse.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-name" className={labelClass}>
              Name
            </Label>
            <Input
              id="wh-name"
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
            <Label htmlFor="wh-address" className={labelClass}>
              Address
            </Label>
            <Input
              id="wh-address"
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-capacity" className={labelClass}>
              Rated capacity (MT)
            </Label>
            <Input
              id="wh-capacity"
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
