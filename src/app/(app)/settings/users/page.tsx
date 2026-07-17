import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listProfiles } from "@/lib/users";
import { UserDialog } from "./user-dialog";
import { ROLE_LABELS } from "./roles";

export default async function UsersRolesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const users = await listProfiles();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users &amp; Roles</h1>
        <p className="text-sm text-muted-foreground">Assign roles and activate or deactivate access.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Department</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">{u.full_name}</td>
                <td className="px-4 py-2.5">{ROLE_LABELS[u.role] ?? u.role}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.department ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.active ? "bg-[#0f9d8c]/10 text-[#0f9d8c]" : "bg-muted text-muted-foreground"}`}>
                    {u.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <UserDialog user={{ id: u.id, full_name: u.full_name, role: u.role, active: u.active }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
