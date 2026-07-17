export type Severity = "critical" | "warning" | "notice";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };

export function severityRank(sev: string): number {
  return SEVERITY_RANK[sev as Severity] ?? 99;
}

/** Critical first, then most-recent within a severity. Mutates and returns the list. */
export function sortBySeverity<T extends { severity: string; created_at: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    return r !== 0 ? r : b.created_at.localeCompare(a.created_at);
  });
}

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  weight_shortage: "Weight shortage",
  missing_bl: "Missing B/L",
  missing_payment_terms: "Missing payment terms",
  compliance_block: "Compliance block",
  overdue_invoice: "Overdue invoice",
  low_capacity: "Low capacity",
};
