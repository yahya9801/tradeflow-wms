import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getLiveRows, carrierGroups } from "@/lib/live-ops";
import { getOpenExceptions, getExceptionStats, refreshOverdue } from "@/lib/exceptions";
import { ActionCenter } from "@/components/action-center";
import { LiveGrid } from "@/components/live-grid";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function LiveOpsPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const showMoney = can(gate.session.profile.role, "view_financials");
  await refreshOverdue();
  const [rows, stats, exceptions] = await Promise.all([
    getLiveRows(),
    getExceptionStats(),
    getOpenExceptions(10),
  ]);
  const carriers = carrierGroups(rows);
  const totalMt = rows.reduce((s, r) => s + r.quantity_mt, 0);
  const totalValue = showMoney ? rows.reduce((s, r) => s + (r.market_value ?? 0), 0) : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Live Ops</h1>
        <p className="text-sm text-muted-foreground">Command centre — live pipeline, carriers, and alerts.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active lots" value={rows.length.toLocaleString("en-US")} />
        <Stat label="Total volume" value={mt(totalMt)} />
        <Stat label="Open exceptions" value={stats.total.toLocaleString("en-US")} sub={`${stats.critical} critical`} />
        {totalValue != null ? (
          <Stat label="Portfolio value" value={`USD ${totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        ) : (
          <Stat label="Carriers" value={carriers.length.toLocaleString("en-US")} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Pipeline by carrier</h2>
          <ul className="flex flex-col gap-2">
            {carriers.slice(0, 8).map((c) => (
              <li key={c.carrier} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.carrier}</span>
                <span className="tabular-nums text-muted-foreground">{c.lots} lots · {mt(c.mt)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Alerts</h2>
          <ActionCenter exceptions={exceptions} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Live grid</h2>
        <LiveGrid rows={rows} showMoney={showMoney} />
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
