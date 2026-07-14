import { PlaceholderPage } from "@/components/placeholder-page";

export default async function LotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PlaceholderPage
      title="Lot Detail"
      description={`Status stepper, shipment/storage cards, related invoices, and resolvable exceptions for lot ${id}.`}
      phase="Phase 4"
    />
  );
}
