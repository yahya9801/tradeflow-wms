import Link from "next/link";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getPnlSummary, getCommodityPerformance, getLedgerFeed } from "@/lib/reports";
import { getAccountsSummary } from "@/lib/finance";
import { marginPct, RANGE_LABELS, type ReportRange } from "@/lib/report-range";

const RANGES: ReportRange[] = ["month", "90d", "all"];
const usd = (n: number) => `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number, ccy: string) => `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const neg = (n: number) => (n < 0 ? "text-destructive" : "");

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  const sp = await searchParams;
  const range: ReportRange = RANGES.includes(sp.range as ReportRange) ? (sp.range as ReportRange) : "90d";

  const [summary, commodities, ledger, exposure] = await Promise.all([
    getPnlSummary(range),
    getCommodityPerformance(range),
    getLedgerFeed(range),
    getAccountsSummary(),
  ]);

  const margin = marginPct(summary.gross_profit, summary.revenue);
  const liquidation = summary.revenue > 0 ? (summary.ar_collected / summary.revenue) * 100 : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet / P&amp;L</h1>
          <p className="text-sm text-muted-foreground">Revenue, cost, and margin by {RANGE_LABELS[range].toLowerCase()}.</p>
        </div>
        <nav className="flex w-fit gap-1 rounded-lg border p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/reports?range=${r}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </nav>
      </div>

      {/* Executive summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue" value={usd(summary.revenue)} />
        <Stat label="Cost" value={usd(summary.cost)} />
        <Stat label="Gross profit" value={usd(summary.gross_profit)} cls={neg(summary.gross_profit)} />
        <Stat label="Margin" value={pct(margin)} cls={neg(margin)} />
      </div>

      {/* AR/AP flow */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">AR / AP flow</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Collected (AR)" value={usd(summary.ar_collected)} />
          <Stat label="Pipeline (AR outstanding)" value={usd(summary.ar_outstanding)} />
          <Stat label="Liquidation" value={pct(liquidation)} />
        </div>
      </div>

      {/* Commodity performance */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Commodity performance</h2>
        {commodities.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invoices in this range.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Commodity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {commodities.map((c) => (
                  <tr key={c.commodity} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{c.commodity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(c.revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(c.cost)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${neg(c.profit)}`}>{usd(c.profit)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${neg(c.margin)}`}>{pct(c.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Currency exposure */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Currency exposure</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {exposure.positions.map((p) => (
            <div key={p.currency} className="flex flex-col gap-2 rounded-xl border p-5">
              <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{p.currency}</span>
              <span className={`text-lg font-semibold tabular-nums ${neg(p.net)}`}>{money(p.net, p.currency)}</span>
              <span className="text-xs text-muted-foreground">
                AR {money(p.ar_outstanding, p.currency)} · AP {money(p.ap_outstanding, p.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger activity */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Ledger activity</h2>
        {ledger.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invoices in this range.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{l.invoice_no}</td>
                    <td className="px-4 py-2.5">{l.type === "receivable" ? "AR" : "AP"}</td>
                    <td className="px-4 py-2.5">{l.client ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(l.amount, l.currency)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{l.due_date ?? "—"}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-5">
      <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</span>
    </div>
  );
}
