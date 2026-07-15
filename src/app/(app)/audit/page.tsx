import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function AuditLogPage() {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return <BlockedScreen required="view_audit" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Audit Log"
      description="Append-only, hash-chained activity trail with a verify-chain function."
      phase="Phase 9"
    />
  );
}
