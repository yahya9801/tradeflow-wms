"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** URL-driven so a filtered directory is shareable and survives reload. */
export function ClientFilters({
  counts,
}: {
  counts: { buyers: number; suppliers: number; withLots: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const type = params.get("type") ?? "";

  const chips = [
    { value: "", label: "All" },
    { value: "buyer", label: `Buyers · ${counts.buyers}` },
    { value: "supplier", label: `Suppliers · ${counts.suppliers}` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-56 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients by name…"
          className="pl-9"
          aria-label="Search clients"
        />
      </form>

      <div className="flex items-center gap-1 rounded-lg border p-0.5">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => set({ type: c.value || null })}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              type === c.value
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
