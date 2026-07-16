import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getLot, listCommodities, listClients } from "@/lib/lots";
import { LotForm } from "../../lot-form";

export default async function EditLotPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return <BlockedScreen required="manage_lots" role={gate.role} />;

  const { id } = await params;
  const lot = await getLot(id);
  if (!lot) notFound();

  const [commodities, clients] = await Promise.all([listCommodities(), listClients()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`/lots/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {lot.lot_number}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit {lot.lot_number}</h1>
        <p className="text-sm text-muted-foreground">
          Status changes happen on the lot page, not here.
        </p>
      </div>
      <LotForm
        commodities={commodities}
        clients={clients}
        initial={{
          id: lot.id,
          direction: lot.direction,
          status: lot.status,
          commodity_id: lot.commodity_id,
          client_id: lot.client_id,
          quantity_mt: String(lot.quantity_mt),
          origin_country: lot.origin_country ?? "",
          destination_country: lot.destination_country ?? "",
          vessel_name: lot.vessel_name ?? "",
          bl_number: lot.bl_number ?? "",
          export_ref: lot.export_ref ?? "",
          payment_terms: lot.payment_terms ?? "",
          eta: lot.eta ?? "",
          notes: lot.notes ?? "",
        }}
      />
    </div>
  );
}
