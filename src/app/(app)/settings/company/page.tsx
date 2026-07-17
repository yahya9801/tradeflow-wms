import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getCompany } from "@/lib/company";
import { CompanyForm } from "./company-form";

export default async function CompanyInfoPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const company = await getCompany();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Company Info</h1>
        <p className="text-sm text-muted-foreground">Used on invoices and delivery documents.</p>
      </div>
      {company ? <CompanyForm company={company} /> : <p className="text-sm text-muted-foreground">No company profile found.</p>}
    </div>
  );
}
