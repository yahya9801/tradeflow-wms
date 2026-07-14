import { PlaceholderPage } from "@/components/placeholder-page";

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PlaceholderPage
      title="Client Profile"
      description={`Contact, trading volume, lots, and (permission-gated) invoices for client ${id}.`}
      phase="Phase 5"
    />
  );
}
