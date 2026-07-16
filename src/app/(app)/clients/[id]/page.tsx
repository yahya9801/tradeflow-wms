import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getClient, getClientStats, getClientLots, getClientInvoices } from "@/lib/clients";
import { STATUS_LABELS, type LotStatus } from "@/lib/lot-status";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;
const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABELS: Record<string, string> = {
  buyer: "Buyer",
  supplier: "Supplier",
  both: "Buyer & Supplier",
};

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const showMoney = can(gate.session.profile.role, "view_financials");

  const [stats, lots, invoices] = await Promise.all([
    getClientStats(id),
    getClientLots(id),
    // Not merely hidden: RLS returns nothing for Management anyway.
    showMoney ? getClientInvoices(id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href="/clients"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Clients
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {TYPE_LABELS[client.type] ?? client.type}
            {client.country ? ` · ${client.country}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Contact</h2>
          <dl className="flex flex-col gap-2">
            {[
              { label: "Contact", value: client.contact_name },
              { label: "Email", value: client.email },
              { label: "Phone", value: client.phone },
              { label: "Currency", value: client.currency },
            ].map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="text-sm">{r.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Volume</h2>
          <dl className="grid grid-cols-2 gap-4">
            {[
              { label: "Total lots", value: stats.lots.toLocaleString("en-US") },
              { label: "Total quantity", value: mt(stats.total_mt) },
              { label: "Imports", value: stats.imports.toLocaleString("en-US") },
              { label: "Exports", value: stats.exports.toLocaleString("en-US") },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Lots</h2>
        {lots.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No lots for this client yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Lot</th>
                  <th className="px-4 py-2.5 font-medium">Dir</th>
                  <th className="px-4 py-2.5 font-medium">Commodity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/lots/${l.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {l.lot_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {l.direction === "import" ? "IMP" : "EXP"}
                    </td>
                    <td className="px-4 py-2.5">{l.commodity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{mt(l.quantity_mt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {STATUS_LABELS[l.status as LotStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showMoney ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Invoices</h2>
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No invoices for this client.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Lot</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{i.invoice_no}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{i.lot_number ?? "—"}</td>
                      <td className="px-4 py-2.5">{i.type === "receivable" ? "AR" : "AP"}</td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">{i.status}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount, i.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {money(i.amount_paid, i.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
