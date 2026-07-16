import Link from "next/link";
import { Plus } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getPipeline } from "@/lib/lots";
import { buttonVariants } from "@/components/ui/button";
import { PipelineBoard } from "@/components/pipeline-board";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function ImportsPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const pipeline = await getPipeline("import");
  const stats = [
    { label: "Import lots", value: pipeline.stats.total.toLocaleString("en-US") },
    { label: "In transit", value: pipeline.stats.in_transit.toLocaleString("en-US") },
    { label: "Stored", value: pipeline.stats.stored.toLocaleString("en-US") },
    { label: "Total quantity", value: mt(pipeline.stats.total_mt) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="text-sm text-muted-foreground">Inbound pipeline, grouped by lifecycle status.</p>
        </div>
        {can(gate.session.profile.role, "manage_lots") ? (
          <Link href="/lots/new?direction=import" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            <Plus className="size-4" />
            New import lot
          </Link>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {pipeline.stats.total === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No import lots yet</p>
          <p className="mt-1 text-sm text-muted-foreground">New import lots will appear here across the pipeline.</p>
        </div>
      ) : (
        <PipelineBoard pipeline={pipeline} />
      )}
    </div>
  );
}
