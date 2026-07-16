"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteClient, type ClientActionState } from "../actions";

/** Deletion is refused (with a reason) when the client has lots or invoices. */
export function DeleteClientButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState<ClientActionState, FormData>(deleteClient, { error: null });

  // On a clean delete the client no longer exists — return to the directory.
  useEffect(() => {
    if (state.ok) router.push("/clients");
  }, [state, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={clientId} />
        <Button type="submit" variant="outline" size="sm" className="gap-1.5">
          <Trash2 className="size-4" />
          Delete
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
