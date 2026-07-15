import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function CompanyInfoPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Company Info"
      description="Company profile used on invoices and delivery documents."
      phase="Phase 9"
    />
  );
}
