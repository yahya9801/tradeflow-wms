import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listCommodities, listClients } from "@/lib/lots";
import { LotForm } from "../lot-form";

export default async function NewLotPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>;
}) {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return <BlockedScreen required="manage_lots" role={gate.role} />;

  const { direction } = await searchParams;
  const initialDirection = direction === "export" ? "export" : "import";

  const [commodities, clients] = await Promise.all([listCommodities(), listClients()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/lots" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Lots
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New lot</h1>
        <p className="text-sm text-muted-foreground">
          The lot number is assigned automatically. New lots start as Pending.
        </p>
      </div>
      <LotForm
        commodities={commodities}
        clients={clients}
        initial={{
          direction: initialDirection, status: "pending", commodity_id: "", client_id: "",
          quantity_mt: "", origin_country: "", destination_country: "", vessel_name: "",
          bl_number: "", export_ref: "", payment_terms: "", eta: "", notes: "",
        }}
      />
    </div>
  );
}
