import { Package } from "lucide-react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — TradeFlow WMS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="relative flex min-h-svh items-center justify-center px-4 py-10">
      {/*
        Signature: the ruled tally sheet / floor plan of a warehouse, barely
        there. Atmosphere drawn from the subject rather than a decorative
        gradient — and it costs nothing but two gradients.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Package className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight">TradeFlow WMS</h1>
            <p className="text-sm text-muted-foreground">
              Commodity trade &amp; warehouse operations
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          <LoginForm next={next ?? "/dashboard"} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is provisioned by your administrator.
        </p>
      </div>
    </main>
  );
}
