import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listClientsDirectory } from "@/lib/clients";
import { ClientFilters } from "./client-filters";

const TYPE_LABELS: Record<string, string> = {
  buyer: "Buyer",
  supplier: "Supplier",
  both: "Buyer & Supplier",
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const sp = await searchParams;
  const { rows, counts } = await listClientsDirectory({ q: sp.q, type: sp.type });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          {counts.buyers} buyers · {counts.suppliers} suppliers · {counts.withLots} with active lots.
        </p>
      </div>

      <ClientFilters counts={counts} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No clients match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try clearing the search or type filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Country</th>
                <th className="px-4 py-2.5 text-right font-medium">Lots</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="group border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/clients/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABELS[c.type] ?? c.type}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.country ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.lot_count.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/clients/${c.id}`} aria-label={`Open ${c.name}`}>
                      <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
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
