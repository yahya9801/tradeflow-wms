"use client";

import { useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel,
  getGroupedRowModel, getSortedRowModel, useReactTable,
  type GroupingState, type SortingState,
} from "@tanstack/react-table";

import type { LiveRow } from "@/lib/live-ops";
import { STATUS_LABELS, type LotStatus } from "@/lib/lot-status";
import { useRealtimeRefresh } from "./use-realtime-refresh";

const col = createColumnHelper<LiveRow>();
const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export function LiveGrid({ rows, showMoney }: { rows: LiveRow[]; showMoney: boolean }) {
  useRealtimeRefresh("lots,exceptions");

  const [sorting, setSorting] = useState<SortingState>([]);
  const [buyer, setBuyer] = useState("all");
  const grouping: GroupingState = ["status"];

  const buyers = useMemo(() => [...new Set(rows.map((r) => r.client))].sort(), [rows]);
  const filtered = useMemo(() => (buyer === "all" ? rows : rows.filter((r) => r.client === buyer)), [rows, buyer]);

  const columns = useMemo(() => {
    // Build via spread (not .push) so the conditional value column doesn't
    // collide with the inferred union element type of the base array.
    const valueCol = col.accessor("market_value", {
      header: "Value",
      cell: (c) => {
        const v = c.getValue();
        return v == null ? "—" : `USD ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      },
    });
    return [
      col.accessor("status", { header: "Status", cell: (c) => STATUS_LABELS[c.getValue() as LotStatus] }),
      col.accessor("lot_number", { header: "Lot", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
      col.accessor("commodity", { header: "Commodity" }),
      col.accessor("client", { header: "Client" }),
      col.accessor("carrier", { header: "Carrier", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("quantity_mt", { header: "Quantity", cell: (c) => mt(c.getValue()) }),
      ...(showMoney ? [valueCol] : []),
    ];
  }, [showMoney]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { grouping, sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    autoResetExpanded: false,
    initialState: { expanded: true },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Buyer</label>
        <select
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="all">All</option>
          {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-2.5 font-medium">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) =>
              row.getIsGrouped() ? (
                <tr key={row.id} className="border-b bg-muted/20">
                  <td colSpan={row.getVisibleCells().length} className="px-4 py-2 text-xs font-medium">
                    {STATUS_LABELS[row.groupingValue as LotStatus] ?? String(row.groupingValue)} · {row.subRows.length}
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
