import Link from "next/link";
import type { InvoiceRow } from "@/lib/finance";

const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InvoiceTable({
  rows,
  actions,
}: {
  rows: InvoiceRow[];
  /** Per-row action controls (edit/pay/delete), injected by the page in Task 7. */
  actions?: (row: InvoiceRow) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No invoices</p>
        <p className="mt-1 text-sm text-muted-foreground">Nothing matches this filter yet.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Invoice</th>
            <th className="px-4 py-2.5 font-medium">Client</th>
            <th className="px-4 py-2.5 font-medium">Lot</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Amount</th>
            <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
            <th className="px-4 py-2.5 font-medium">Due</th>
            {actions ? <th className="px-4 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2.5 font-mono text-xs">{i.invoice_no}</td>
              <td className="px-4 py-2.5">
                <Link href={`/clients/${i.client_id}`} className="underline-offset-4 hover:underline">
                  {i.client_name ?? "—"}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                {i.lot_id ? (
                  <Link href={`/lots/${i.lot_id}`} className="underline-offset-4 hover:underline">
                    {i.lot_number}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-2.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{i.status}</span>
                {i.overdue ? (
                  <span className="ml-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    Overdue
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount, i.currency)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(i.outstanding, i.currency)}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i.due_date ?? "—"}</td>
              {actions ? <td className="px-4 py-2.5 text-right">{actions(i)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
