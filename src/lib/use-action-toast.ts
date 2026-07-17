"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ActionState = { ok?: boolean; error?: string | null };

/**
 * Fires a success toast when an action's `state.ok` flips true, and an error
 * toast when a top-level `state.error` appears. Field-level validation errors
 * (which set `fieldErrors` but leave `error` null) are left to inline UI.
 */
export function useActionToast(
  state: ActionState & { fieldErrors?: Record<string, string> },
  messages: { success: string; error?: (e: string) => string },
): void {
  const seen = useRef(state);
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.ok) toast.success(messages.success);
    else if (state.error) toast.error(messages.error ? messages.error(state.error) : state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}
