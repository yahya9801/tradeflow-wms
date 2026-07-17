"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for local debugging; the UI never shows the stack.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border p-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          This screen hit an unexpected error. You can try again — if it keeps happening, note the code below.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
      {error.digest ? <p className="font-mono text-[0.6875rem] text-muted-foreground">ref: {error.digest}</p> : null}
    </div>
  );
}
