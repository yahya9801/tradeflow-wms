import Link from "next/link";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getAccountsSummary, getAging, listInvoices, type InvoiceType } from "@/lib/finance";
import { InvoiceTable } from "./invoice-table";

const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "receivable", label: "Receivable" },
  { key: "payable", label: "Payable" },
] as const;

const STATUSES = ["all", "pending", "partial", "paid"] as const;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string; q?: string }>;
}) {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">Receivables, payables, aging, and currency exposure.</p>
      </div>

      <nav className="flex w-fit gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/accounts?tab=${t.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview /> : <Ledger type={tab as InvoiceType} status={sp.status} q={sp.q} />}
    </div>
  );
}

async function Overview() {
  const [summary, arAging, apAging] = await Promise.all([
    getAccountsSummary(),
    getAging("receivable"),
    getAging("payable"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summary.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          summary.positions.map((p) => (
            <div key={p.currency} className="flex flex-col gap-3 rounded-xl border p-5">
              <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {p.currency}
              </h2>
              <dl className="flex flex-col gap-2">
                <Stat label="Net position" value={money(p.net, p.currency)} strong />
                <Stat label="AR outstanding" value={money(p.ar_outstanding, p.currency)} />
                <Stat label="AP outstanding" value={money(p.ap_outstanding, p.currency)} />
              </dl>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AgingCard title="Receivable aging" buckets={arAging} />
        <AgingCard title="Payable aging" buckets={apAging} />
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.ar_count} receivable · {summary.ap_count} payable · {summary.overdue_count} overdue.
      </p>
    </div>
  );
}

function AgingCard({ title, buckets }: { title: string; buckets: { label: string; amount: number }[] }) {
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="tabular-nums">{b.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: total > 0 ? `${Math.round((b.amount / total) * 100)}%` : "0%" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function Ledger({ type, status, q }: { type: InvoiceType; status?: string; q?: string }) {
  const rows = await listInvoices({ type, status, q });
  const active = STATUSES.includes((status ?? "all") as (typeof STATUSES)[number]) ? status ?? "all" : "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((s) => {
          const params = new URLSearchParams({ tab: type });
          if (s !== "all") params.set("status", s);
          if (q) params.set("q", q);
          return (
            <Link
              key={s}
              href={`/accounts?${params.toString()}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
                active === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </Link>
          );
        })}
      </div>
      <InvoiceTable rows={rows} />
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-base font-semibold tabular-nums" : "text-sm tabular-nums"}>{value}</dd>
    </div>
  );
}
