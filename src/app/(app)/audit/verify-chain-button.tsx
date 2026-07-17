"use client";

import { useActionState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { verifyChainAction, type VerifyState } from "./actions";

const initial: VerifyState = { checked: false, intact: false, badSeq: null, error: null };

export function VerifyChainButton() {
  const [state, action, pending] = useActionState(async () => verifyChainAction(), initial);
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Verifying…" : "Verify chain"}
      </Button>
      {state.error ? (
        <span className="text-sm text-destructive">{state.error}</span>
      ) : state.checked ? (
        state.intact ? (
          <span className="flex items-center gap-1.5 text-sm text-[#0f9d8c]">
            <ShieldCheck className="size-4" /> Chain intact
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <ShieldAlert className="size-4" /> Tampering detected at seq {state.badSeq}
          </span>
        )
      ) : null}
    </form>
  );
}
