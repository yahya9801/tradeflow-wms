"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LOT_STATUSES, STATUS_LABELS } from "@/lib/lot-status";

/**
 * Filters live in the URL so a filtered view is shareable and bookmarkable,
 * and the server does the filtering.
 */
export function LotFilters({ statusCounts }: { statusCounts: Record<string, number> }) {
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
    next.delete("page"); // any filter change resets paging
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const direction = params.get("direction") ?? "";
  const status = params.get("status") ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative flex-1 min-w-56"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search lot number, commodity, counterparty…"
            className="pl-9"
            aria-label="Search lots"
          />
        </form>

        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {[
            { value: "", label: "All" },
            { value: "import", label: "Import" },
            { value: "export", label: "Export" },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set({ direction: o.value || null })}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                direction === o.value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <button
          type="button"
          onClick={() => set({ status: null })}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            !status ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {LOT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set({ status: s })}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
              status === s ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {STATUS_LABELS[s]}
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              {statusCounts[s] ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
