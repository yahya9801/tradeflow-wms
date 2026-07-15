import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function ReportsPage() {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Balance Sheet / P&L"
      description="Executive summary, commodity performance, and currency exposure over a date range."
      phase="Phase 8"
    />
  );
}
