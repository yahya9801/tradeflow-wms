import { PlaceholderPage } from "@/components/placeholder-page";

export default async function FacilityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PlaceholderPage
      title="Facility Detail"
      description={`Per-shed breakdown and clickable historical-lot list for facility ${id}.`}
      phase="Phase 3"
    />
  );
}
