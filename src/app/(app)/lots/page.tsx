import Link from "next/link";
import { Plus } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { listLots, PAGE_SIZE } from "@/lib/lots";
import { STATUS_LABELS } from "@/lib/lot-status";
import { buttonVariants } from "@/components/ui/button";
import { LotFilters } from "./lot-filters";

export default async function LotsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; direction?: string; status?: string; page?: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const sp = await searchParams;
  const requested = Number(sp.page ?? 1);
  const requestedPage = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;

  const initial = await listLots({
    q: sp.q, direction: sp.direction, status: sp.status, page: requestedPage,
  });

  const pages = Math.max(1, Math.ceil(initial.total / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);

  // listLots clamps the low end internally but not the high end, so an
  // out-of-range page (e.g. ?page=999 on a 4-page result) comes back with
  // empty rows even though total is nonzero. Refetch with the clamped page
  // so the rendered rows always match the rendered "Page X of Y" header.
  const { rows, total, statusCounts } =
    page === requestedPage
      ? initial
      : await listLots({ q: sp.q, direction: sp.direction, status: sp.status, page });
  const qs = (p: number) => {
    const next = new URLSearchParams();
    if (sp.q) next.set("q", sp.q);
    if (sp.direction) next.set("direction", sp.direction);
    if (sp.status) next.set("status", sp.status);
    next.set("page", String(p));
    return `/lots?${next.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Lots</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString("en-US")} lot{total === 1 ? "" : "s"} across every stage of the lifecycle.
          </p>
        </div>
        {can(gate.session.profile.role, "manage_lots") ? (
          <Link href="/lots/new" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            <Plus className="size-4" />
            New lot
          </Link>
        ) : null}
      </div>

      <LotFilters statusCounts={statusCounts} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No lots match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try clearing the search or status filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Lot</th>
                <th className="px-4 py-2.5 font-medium">Dir</th>
                <th className="px-4 py-2.5 font-medium">Commodity</th>
                <th className="px-4 py-2.5 font-medium">Counterparty</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                <th className="px-4 py-2.5 text-right font-medium">Bags</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/lots/${l.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {l.lot_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {l.direction === "import" ? "IMP" : "EXP"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{l.commodity}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{l.client}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {l.quantity_mt.toLocaleString("en-US")} MT
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {l.bags.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {l.shed ? `${l.warehouse} · ${l.shed}` : (l.warehouse ?? "—")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {STATUS_LABELS[l.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={qs(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={qs(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
