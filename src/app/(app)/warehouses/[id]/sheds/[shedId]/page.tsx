import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getShed, getShedHistory, getWarehouse } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const days = (from: string, to: string | null) =>
  Math.max(1, Math.round((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 86_400_000));

export default async function ShedHistoryPage({
  params,
}: {
  params: Promise<{ id: string; shedId: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id, shedId } = await params;
  const [shed, warehouse] = await Promise.all([getShed(shedId), getWarehouse(id)]);

  // 404 rather than render mismatched data if the shed isn't in this warehouse.
  if (!shed || !warehouse || shed.warehouse_id !== id) notFound();

  const history = await getShedHistory(shedId);
  const current = history.filter((s) => s.removed_at === null);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href={`/warehouses/${id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {warehouse.name}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{shed.name}</h1>
        <p className="text-sm text-muted-foreground">
          {history.length} lot{history.length === 1 ? "" : "s"} have occupied this shed · {current.length} stored
          now
        </p>
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No lots have been stored here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lot history appears once a lot is placed in this shed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Lot</th>
                <th className="px-4 py-2.5 font-medium">Commodity</th>
                <th className="px-4 py-2.5 font-medium">Counterparty</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                <th className="px-4 py-2.5 font-medium">Placed</th>
                <th className="px-4 py-2.5 font-medium">Removed</th>
                <th className="px-4 py-2.5 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/lots/${s.lot_id}`}
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {s.lot_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{s.commodity}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.client}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.quantity_mt.toLocaleString("en-US")} MT
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(s.placed_at)}</td>
                  <td className="px-4 py-2.5">
                    {s.removed_at ? (
                      <span className="tabular-nums text-muted-foreground">{fmtDate(s.removed_at)}</span>
                    ) : (
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium">
                        Currently stored
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {days(s.placed_at, s.removed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
