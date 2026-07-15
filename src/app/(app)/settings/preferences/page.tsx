import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function PreferencesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Preferences"
      description="Default currency, date format, alert thresholds, and toggles."
      phase="Phase 9"
    />
  );
}
