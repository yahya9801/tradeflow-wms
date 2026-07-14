import { PlaceholderPage } from "@/components/placeholder-page";

export default async function EditLotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PlaceholderPage
      title="Edit Lot"
      description={`Edit form for lot ${id}; every change is audit-logged.`}
      phase="Phase 4"
    />
  );
}
