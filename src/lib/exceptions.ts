import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sortBySeverity, type Severity } from "@/lib/exception-format";

export type OpenException = {
  id: string;
  lot_id: string | null;
  lot_number: string | null;
  type: string;
  severity: Severity;
  description: string;
  created_at: string;
};

export type ExceptionStats = { critical: number; warning: number; notice: number; total: number };

/** Materialise overdue-invoice exceptions. Idempotent; call before reading. */
export async function refreshOverdue(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("refresh_overdue_exceptions");
}

export async function getOpenExceptions(limit?: number): Promise<OpenException[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exceptions")
    .select("id, lot_id, type, severity, description, created_at, lots(lot_number)")
    .eq("status", "open");
  if (error) throw new Error(`getOpenExceptions: ${error.message}`);

  type Row = {
    id: string; lot_id: string | null; type: string; severity: Severity;
    description: string; created_at: string; lots: { lot_number: string } | null;
  };
  const rows: OpenException[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_id: r.lot_id,
    lot_number: r.lots?.lot_number ?? null,
    type: r.type,
    severity: r.severity,
    description: r.description,
    created_at: r.created_at,
  }));
  const sorted = sortBySeverity(rows);
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function getExceptionStats(): Promise<ExceptionStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("exceptions").select("severity").eq("status", "open");
  const stats: ExceptionStats = { critical: 0, warning: 0, notice: 0, total: 0 };
  for (const r of (data ?? []) as { severity: Severity }[]) {
    stats[r.severity]++;
    stats.total++;
  }
  return stats;
}
