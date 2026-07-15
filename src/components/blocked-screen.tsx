import Link from "next/link";
import { Lock } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { AppRole, Capability } from "@/lib/permissions";

const CAPABILITY_LABELS: Record<Capability, string> = {
  view_operations: "Operations access",
  manage_lots: "Lot management",
  view_financials: "Financial access",
  manage_invoices: "Invoice management",
  view_audit: "Audit log access",
  manage_users: "User & settings management",
};

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  management: "Management",
  finance: "Finance",
  warehouse: "Warehouse",
};

/**
 * Shown when an authenticated user reaches a screen their role doesn't cover
 * — including by typing the URL. Explains the restriction rather than
 * bouncing silently; the server already refused to render the content.
 */
export function BlockedScreen({
  required,
  role,
}: {
  required: Capability;
  role: AppRole;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-5" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Owner access required</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This screen needs{" "}
          <span className="font-medium text-foreground">{CAPABILITY_LABELS[required]}</span>. You&apos;re
          signed in as{" "}
          <span className="font-mono text-xs uppercase tracking-wider text-foreground">
            {ROLE_LABELS[role]}
          </span>
          , which doesn&apos;t include it.
        </p>
        <p className="text-sm text-muted-foreground">Ask an Owner if you need access.</p>
      </div>

      {/* A navigation control stays an <a>: styled with buttonVariants rather
          than Base UI's Button, which expects a native <button>. Solid variant
          because this is the only action on the screen. */}
      <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
        Back to Dashboard
      </Link>
    </div>
  );
}
