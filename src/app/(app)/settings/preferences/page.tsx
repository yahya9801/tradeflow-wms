import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getPreferences } from "@/lib/preferences";
import { PreferencesForm } from "./preferences-form";

export default async function PreferencesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const prefs = await getPreferences();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-sm text-muted-foreground">Currency, date format, thresholds, and alert types.</p>
      </div>
      <PreferencesForm prefs={prefs} />
    </div>
  );
}
