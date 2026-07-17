"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveUser, type UserActionState } from "./actions";
import { ROLES, ROLE_LABELS, roleBlurb } from "./roles";
import type { AppRole } from "@/lib/permissions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>;
}

export function UserDialog({ user }: { user: { id: string; full_name: string; role: AppRole; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<UserActionState, FormData>(saveUser, { error: null });
  const [role, setRole] = useState<AppRole>(user.role);
  const [active, setActive] = useState(user.active);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{user.full_name}</DialogTitle>
        <DialogDescription>Role and access for this user.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="id" value={user.id} />

          <fieldset className="flex flex-col gap-2">
            {ROLES.map((r) => (
              <label key={r} className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 ${role === r ? "border-ring ring-2 ring-ring/40" : ""}`}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                  {ROLE_LABELS[r]}
                </span>
                <span className="pl-6 text-xs text-muted-foreground">{roleBlurb(r)}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (deactivated users cannot sign in)
          </label>

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
