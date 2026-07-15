/**
 * The single source of truth for "what can this role do?".
 *
 * This mirrors the Phase 1 SQL helpers exactly (can_view_financials(),
 * is_owner()). RLS is the enforcement mechanism; this module exists so the
 * server can gate routes and the UI can hide what the user cannot use.
 * If the two ever disagree, permissions.test.ts fails.
 */
export type AppRole = "owner" | "management" | "warehouse" | "finance";

export type Capability =
  | "view_operations"
  | "manage_lots"
  | "view_financials"
  | "manage_invoices"
  | "view_audit"
  | "manage_users";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "view_operations",
  "manage_lots",
  "view_financials",
  "manage_invoices",
  "view_audit",
  "manage_users",
];

const ROLE_CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  owner: ALL_CAPABILITIES,
  management: ["view_operations", "manage_lots"],
  // Reserved for v2; schema and matrix already support them.
  finance: ["view_operations", "view_financials", "manage_invoices"],
  warehouse: ["view_operations"],
};

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}
