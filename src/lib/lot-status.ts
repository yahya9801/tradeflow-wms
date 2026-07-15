/**
 * The lot lifecycle. This mirrors the SQL trigger in 0011_lot_rules.sql —
 * the database is the enforcement mechanism; this exists so the UI can offer
 * only the moves that will actually succeed. lot-status.test.ts pins both to
 * the same rules so they cannot drift.
 */
export type LotStatus =
  | "pending"
  | "in_transit"
  | "received"
  | "stored"
  | "dispatched"
  | "delivered";

export const LOT_STATUSES: readonly LotStatus[] = [
  "pending",
  "in_transit",
  "received",
  "stored",
  "dispatched",
  "delivered",
];

export const STATUS_LABELS: Record<LotStatus, string> = {
  pending: "Pending",
  in_transit: "In Transit",
  received: "Received",
  stored: "Stored",
  dispatched: "Dispatched",
  delivered: "Delivered",
};

export function statusIndex(status: LotStatus): number {
  return LOT_STATUSES.indexOf(status);
}

/**
 * Next step for anyone; Owner may also step back one to correct a mistake.
 * Forward first so the primary action is always [0].
 */
export function allowedTransitions(current: LotStatus, isOwner: boolean): LotStatus[] {
  const i = statusIndex(current);
  const out: LotStatus[] = [];
  if (i < LOT_STATUSES.length - 1) out.push(LOT_STATUSES[i + 1]);
  if (isOwner && i > 0) out.push(LOT_STATUSES[i - 1]);
  return out;
}
