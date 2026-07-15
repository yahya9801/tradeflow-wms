import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function UsersRolesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Users & Roles"
      description="Add/deactivate users and assign roles with capability descriptions."
      phase="Phase 9"
    />
  );
}
