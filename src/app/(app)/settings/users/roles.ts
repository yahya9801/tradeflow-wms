import type { AppRole } from "@/lib/permissions";

export const ROLES: AppRole[] = ["owner", "management", "finance", "warehouse"];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  management: "Management",
  finance: "Finance",
  warehouse: "Warehouse",
};

/** One-line capability blurb per role, for the dialog. */
export function roleBlurb(role: AppRole): string {
  const caps = {
    owner: "Full access — financials, audit, users & settings.",
    management: "Operations and lots; no financials.",
    finance: "Operations, financials, and invoices.",
    warehouse: "Operations only.",
  } as const;
  return caps[role];
}
