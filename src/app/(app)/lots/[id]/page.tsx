import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  getLot, getLotInvoices, getLotExceptions, listWarehousesWithSheds,
} from "@/lib/lots";
import { listClientOptions, listLotOptions } from "@/lib/finance";
import { allowedTransitions, STATUS_LABELS } from "@/lib/lot-status";
import { StatusStepper } from "./status-stepper";
import { ExceptionList } from "./exception-list";
import { FlagIssueDialog } from "./flag-issue-dialog";
import { InvoiceDialog } from "@/app/(app)/accounts/invoice-dialog";

const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const lot = await getLot(id);
  if (!lot) notFound();

  const role = gate.session.profile.role;
  const isOwner = role === "owner";
  const showMoney = can(role, "view_financials");
  const canEdit = can(role, "manage_lots");
  const canInvoice = can(role, "manage_invoices");

  const [invoices, exceptions, warehouses, clientOpts, lotOpts] = await Promise.all([
    // Not merely hidden: for Management RLS returns nothing anyway.
    showMoney ? getLotInvoices(id) : Promise.resolve([]),
    getLotExceptions(id),
    canEdit ? listWarehousesWithSheds() : Promise.resolve([]),
    canInvoice ? listClientOptions() : Promise.resolve([]),
    canInvoice ? listLotOptions() : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/lots" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Lots
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{lot.lot_number}</h1>
            <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              {lot.direction}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {lot.commodity} · {lot.quantity_mt.toLocaleString("en-US")} MT ·{" "}
            {lot.bags.toLocaleString("en-US")} bags
          </p>
        </div>
        {canEdit ? (
          <Link href={`/lots/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Edit
          </Link>
        ) : null}
      </div>

      {canEdit ? (
        <StatusStepper
          lotId={lot.id}
          current={lot.status}
          transitions={allowedTransitions(lot.status, isOwner)}
          warehouses={warehouses}
        />
      ) : (
        <div className="rounded-xl border p-5">
          <span className="text-sm">
            Status: <span className="font-medium">{STATUS_LABELS[lot.status]}</span>
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Shipment">
          <Row label="Vessel" value={lot.vessel_name} />
          <Row label="B/L number" value={lot.bl_number} mono />
          <Row label="Export ref" value={lot.export_ref} mono />
          <Row label="Payment terms" value={lot.payment_terms} />
          <Row label="ETA" value={lot.eta} />
        </Card>

        <Card title="Storage">
          <Row label="Warehouse" value={lot.warehouse} />
          <Row label="Shed" value={lot.shed} />
          <Row label="Arrived" value={lot.arrival_date} />
          <Row label="Dispatched" value={lot.dispatch_date} />
        </Card>

        <Card title="Counterparty">
          <Row label="Name" value={lot.client} />
          <Row label="Origin" value={lot.origin_country} />
          <Row label="Destination" value={lot.destination_country} />
        </Card>

        <Card title="Commodity">
          <Row label="Name" value={lot.commodity} />
          <Row label="Quantity" value={`${lot.quantity_mt.toLocaleString("en-US")} MT`} />
          <Row label="Bags" value={`${lot.bags.toLocaleString("en-US")} @ ${lot.bag_weight_kg} kg`} />
          {showMoney && lot.market_value != null ? (
            <Row label="Market value" value={money(lot.market_value, "USD")} />
          ) : null}
        </Card>
      </div>

      {/* The demo gap fix: exceptions are real records, shown here, resolvable. */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Exceptions</h2>
          {canEdit ? <FlagIssueDialog lotId={lot.id} /> : null}
        </div>
        <ExceptionList lotId={lot.id} exceptions={exceptions} canResolve={canEdit} />
      </section>

      {showMoney ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Invoices</h2>
            {canInvoice ? (
              <InvoiceDialog
                clients={clientOpts}
                lots={lotOpts}
                prefill={{
                  client_id: lot.client_id,
                  lot_id: lot.id,
                  type: lot.direction === "export" ? "receivable" : "payable",
                }}
                trigger={<Button size="sm" variant="outline">Raise invoice</Button>}
              />
            ) : null}
          </div>
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No invoices raised against this lot.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{i.invoice_no}</td>
                      <td className="px-4 py-2.5">{i.type === "receivable" ? "AR" : "AP"}</td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">{i.status}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount, i.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {money(i.amount_paid, i.currency)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i.due_date ?? "—"}</td>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <dl className="flex flex-col gap-2">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value || "—"}</dd>
    </div>
  );
}
