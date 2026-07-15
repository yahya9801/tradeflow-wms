"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteShed, type ActionState } from "../actions";

/**
 * Deletion is refused (with a reason) when the shed holds lots or history —
 * the reason is surfaced inline rather than thrown away.
 */
export function DeleteShedButton({ shedId, warehouseId }: { shedId: string; warehouseId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(deleteShed, { error: null });

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={shedId} />
        <input type="hidden" name="warehouse_id" value={warehouseId} />
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Delete shed">
          <Trash2 className="size-4" />
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
