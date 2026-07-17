"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { flagException, type LotActionState } from "../actions";
import { useActionToast } from "@/lib/use-action-toast";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass =
  "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Flagging…" : "Flag issue"}</Button>;
}

export function FlagIssueDialog({ lotId }: { lotId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<LotActionState, FormData>(flagException, { error: null });
  useActionToast(state, { success: "Issue flagged" });
  const [type, setType] = useState("weight_shortage");
  const [severity, setSeverity] = useState("warning");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1.5"><Flag className="size-4" />Flag issue</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Flag an issue</DialogTitle>
        <DialogDescription>Raise a weight-shortage or compliance block against this lot.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="lot_id" value={lotId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-type" className={labelClass}>Type</Label>
              <select id="f-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                <option value="weight_shortage">Weight shortage</option>
                <option value="compliance_block">Compliance block</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-sev" className={labelClass}>Severity</Label>
              <select id="f-sev" name="severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectClass}>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="notice">Notice</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-desc" className={labelClass}>Description</Label>
            <Input id="f-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} required />
            {state.fieldErrors?.description ? <p className="text-xs text-destructive">{state.fieldErrors.description}</p> : null}
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
