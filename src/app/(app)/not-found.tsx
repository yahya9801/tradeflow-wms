import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border p-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">
          The page or record you’re looking for doesn’t exist or may have been removed.
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "default" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
