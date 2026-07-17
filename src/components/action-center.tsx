import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { EXCEPTION_TYPE_LABELS } from "@/lib/exception-format";
import type { OpenException } from "@/lib/exceptions";

const SEVERITY: Record<string, string> = {
  critical: "bg-[#d03b3b]/10 text-[#d03b3b]",
  warning: "bg-[#fab219]/15 text-[#8a5d00] dark:text-[#fab219]",
  notice: "bg-muted text-muted-foreground",
};

export function ActionCenter({ exceptions }: { exceptions: OpenException[] }) {
  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No open exceptions. All clear.
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {exceptions.map((e) => {
        const row = (
          <div className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY[e.severity] ?? SEVERITY.notice}`}>
              {EXCEPTION_TYPE_LABELS[e.type] ?? e.type}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{e.description}</span>
              {e.lot_number ? <span className="font-mono text-[0.6875rem] text-muted-foreground">{e.lot_number}</span> : null}
            </div>
          </div>
        );
        return (
          <li key={e.id} className="hover:bg-muted/30">
            {e.lot_id ? (
              <Link href={`/lots/${e.lot_id}`} className="block">{row}</Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SeverityStat({ label, count, tone }: { label: string; count: number; tone: "critical" | "warning" | "notice" }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <AlertTriangle className={`size-4 ${tone === "critical" ? "text-[#d03b3b]" : tone === "warning" ? "text-[#fab219]" : "text-muted-foreground"}`} />
      <span className="text-sm font-medium tabular-nums">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
