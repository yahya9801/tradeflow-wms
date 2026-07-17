import Link from "next/link";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listAuditEntries, getAuditStats, listActors } from "@/lib/audit-log";
import { auditActionLabel, AUDIT_ACTION_LABELS } from "@/lib/audit-format";
import { VerifyChainButton } from "./verify-chain-button";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string }>;
}) {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return <BlockedScreen required="view_audit" role={gate.role} />;

  const sp = await searchParams;
  const [entries, stats, actors] = await Promise.all([
    listAuditEntries({ actor: sp.actor, action: sp.action }),
    getAuditStats(),
    listActors(),
  ]);

  const actions = Object.keys(AUDIT_ACTION_LABELS);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const actor = patch.actor ?? sp.actor;
    const action = patch.action ?? sp.action;
    if (actor) p.set("actor", actor);
    if (action) p.set("action", action);
    const s = p.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Append-only, hash-chained activity trail.</p>
        </div>
        <VerifyChainButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total entries" value={stats.total.toLocaleString("en-US")} />
        <Stat label="Actors" value={stats.actors.toLocaleString("en-US")} />
        <Stat label="Top action" value={stats.byAction[0] ? auditActionLabel(stats.byAction[0].action) : "—"} sub={stats.byAction[0] ? `${stats.byAction[0].count}` : undefined} />
      </div>

      {/* Action filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ action: undefined, actor: sp.actor })} className={chip(!sp.action)}>All actions</Link>
        {actions.map((a) => (
          <Link key={a} href={qs({ action: a })} className={chip(sp.action === a)}>{auditActionLabel(a)}</Link>
        ))}
      </div>
      {/* Actor filter */}
      {actors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={qs({ actor: undefined, action: sp.action })} className={chip(!sp.actor)}>All actors</Link>
          {actors.map((a) => (
            <Link key={a.id} href={qs({ actor: a.id })} className={chip(sp.actor === a.id)}>{a.name}</Link>
          ))}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No entries match.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Seq</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Entity</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{e.seq}</td>
                  <td className="px-4 py-2.5">{auditActionLabel(e.action)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {e.entity_type}
                    {e.entity_id ? <span className="ml-1 font-mono text-[0.6875rem]">{e.entity_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="px-4 py-2.5">{e.actor ?? "System"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 font-mono text-[0.6875rem] text-muted-foreground" title={e.hash}>{e.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;
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
