export type InvoiceStatus = "pending" | "partial" | "paid";

export function deriveStatus(amount: number, amountPaid: number): InvoiceStatus {
  if (amount > 0 && amountPaid >= amount) return "paid";
  if (amountPaid > 0) return "partial";
  return "pending";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function isOverdue(dueDate: string | null, status: InvoiceStatus, today: Date): boolean {
  if (!dueDate || status === "paid") return false;
  return new Date(dueDate) < startOfDay(today);
}

function daysPastDue(dueDate: string, today: Date): number {
  const ms = startOfDay(today).getTime() - startOfDay(new Date(dueDate)).getTime();
  return Math.floor(ms / 86400000);
}

export type AgingBucket = { label: string; from: number; to: number | null; amount: number };

/** Buckets the unpaid balance by days past due. Buckets sum to total outstanding. */
export function agingBuckets(
  items: { due_date: string | null; outstanding: number }[],
  today: Date,
): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "Current", from: -Infinity, to: 0, amount: 0 },
    { label: "1–30", from: 1, to: 30, amount: 0 },
    { label: "31–60", from: 31, to: 60, amount: 0 },
    { label: "61–90", from: 61, to: 90, amount: 0 },
    { label: "90+", from: 91, to: null, amount: 0 },
  ];
  for (const it of items) {
    const dpd = it.due_date == null ? 0 : daysPastDue(it.due_date, today);
    const bucket =
      dpd <= 0 ? buckets[0]
      : dpd <= 30 ? buckets[1]
      : dpd <= 60 ? buckets[2]
      : dpd <= 90 ? buckets[3]
      : buckets[4];
    bucket.amount += it.outstanding;
  }
  return buckets;
}
