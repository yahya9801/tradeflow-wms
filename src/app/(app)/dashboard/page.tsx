import Link from "next/link";
import { Plus, Warehouse, Users, Package } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";
import { getDashboardOps } from "@/lib/dashboard";
import { getAccountsSummary } from "@/lib/finance";
import { getOpenExceptions, getExceptionStats, refreshOverdue } from "@/lib/exceptions";
import { ActionCenter, SeverityStat } from "@/components/action-center";
import { StorageGauge } from "@/components/storage-gauge";
import { STATUS_LABELS, type LotStatus } from "@/lib/lot-status";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;
const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function DashboardPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const role = gate.session.profile.role;
  const showMoney = can(role, "view_financials");

  await refreshOverdue();
  const [ops, stats, exceptions, summary] = await Promise.all([
    getDashboardOps(),
    getExceptionStats(),
    getOpenExceptions(8),
    showMoney ? getAccountsSummary() : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operations at a glance.</p>
      </div>

      {/* Top stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total lots" value={ops.pipeline.total_lots.toLocaleString("en-US")} />
        <Stat label="In transit" value={mt(ops.pipeline.in_transit_mt)} sub={`${ops.pipeline.in_transit_lots} lots`} />
        <Stat label="Stored" value={mt(ops.pipeline.stored_mt)} sub={`${ops.pipeline.stored_lots} lots`} />
        <Stat label="Open exceptions" value={stats.total.toLocaleString("en-US")} sub={`${stats.critical} critical`} />
      </div>

      {showMoney && summary ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Net position</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summary.positions.map((p) => (
              <div key={p.currency} className="flex flex-col gap-2 rounded-xl border p-5">
                <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{p.currency}</span>
                <span className="text-lg font-semibold tabular-nums">{money(p.net, p.currency)}</span>
                <span className="text-xs text-muted-foreground">
                  AR {money(p.ar_outstanding, p.currency)} · AP {money(p.ap_outstanding, p.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Storage */}
        <div className="flex flex-col items-center gap-3 rounded-xl border p-5">
          <h2 className="self-start font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Storage</h2>
          <StorageGauge pct={ops.overallOccupancyPct} />
        </div>

        {/* Per-warehouse capacity */}
        <div className="flex flex-col gap-3 rounded-xl border p-5 lg:col-span-2">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Per-warehouse capacity</h2>
          <div className="flex flex-col gap-3">
            {ops.warehouses.map((w) => (
              <div key={w.warehouse_id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{w.name}</span>
                  <span className="tabular-nums text-muted-foreground">{Math.round(w.occupancy_pct)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${w.occupancy_pct >= 100 ? "bg-[#d03b3b]" : w.occupancy_pct >= 80 ? "bg-[#fab219]" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, w.occupancy_pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Center */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Action Center</h2>
          <div className="flex gap-2">
            <SeverityStat label="critical" count={stats.critical} tone="critical" />
            <SeverityStat label="warning" count={stats.warning} tone="warning" />
          </div>
        </div>
        <ActionCenter exceptions={exceptions} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick actions */}
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Quick actions</h2>
          <div className="flex flex-wrap gap-2">
            {can(role, "manage_lots") ? (
              <Link href="/lots/new" className={buttonVariants({ variant: "outline", size: "sm" })}><Plus className="size-4" /> New lot</Link>
            ) : null}
            {can(role, "manage_invoices") ? (
              <Link href="/accounts" className={buttonVariants({ variant: "outline", size: "sm" })}><Plus className="size-4" /> New invoice</Link>
            ) : null}
            <Link href="/warehouses" className={buttonVariants({ variant: "outline", size: "sm" })}><Warehouse className="size-4" /> Warehouses</Link>
            <Link href="/clients" className={buttonVariants({ variant: "outline", size: "sm" })}><Users className="size-4" /> Clients</Link>
          </div>
        </div>

        {/* Recent activity */}
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Recent activity</h2>
          <ul className="flex flex-col gap-2">
            {ops.recent.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/lots/${l.id}`} className="flex items-center gap-2 font-mono text-xs underline-offset-4 hover:underline">
                  <Package className="size-3.5 text-muted-foreground" />
                  {l.lot_number}
                </Link>
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[l.status as LotStatus]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-5">
      <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}
