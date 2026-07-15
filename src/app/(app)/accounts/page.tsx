import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function AccountsPage() {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Accounts"
      description="AR/AP overview, aging buckets, currency exposure — Receivable and Payable tabs."
      phase="Phase 6"
    />
  );
}
