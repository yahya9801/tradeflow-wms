import { describe, it, expect } from "vitest";
import { can, ALL_CAPABILITIES } from "./permissions";

describe("can()", () => {
  it("gives owner every capability", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(can("owner", cap)).toBe(true);
    }
  });

  it("gives management only operations and lot management", () => {
    expect(can("management", "view_operations")).toBe(true);
    expect(can("management", "manage_lots")).toBe(true);
    expect(can("management", "view_financials")).toBe(false);
    expect(can("management", "manage_invoices")).toBe(false);
    expect(can("management", "view_audit")).toBe(false);
    expect(can("management", "manage_users")).toBe(false);
  });

  it("denies everything when role is null or undefined", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(can(null, cap)).toBe(false);
      expect(can(undefined, cap)).toBe(false);
    }
  });

  // These three lock the TS matrix to the Phase 1 SQL helpers. If they drift,
  // the UI and RLS disagree — the exact bug class this project exists to kill.
  it("matches SQL can_view_financials(): role in (owner, finance)", () => {
    const expected: Record<string, boolean> = {
      owner: true,
      finance: true,
      management: false,
      warehouse: false,
    };
    for (const [role, want] of Object.entries(expected)) {
      expect(can(role as never, "view_financials")).toBe(want);
    }
  });

  it("matches SQL is_owner() for view_audit", () => {
    expect(can("owner", "view_audit")).toBe(true);
    for (const role of ["management", "finance", "warehouse"] as const) {
      expect(can(role, "view_audit")).toBe(false);
    }
  });

  it("matches SQL is_owner() for manage_users", () => {
    expect(can("owner", "manage_users")).toBe(true);
    for (const role of ["management", "finance", "warehouse"] as const) {
      expect(can(role, "manage_users")).toBe(false);
    }
  });

  it("reserved roles carry their v2 capabilities", () => {
    expect(can("finance", "manage_invoices")).toBe(true);
    expect(can("finance", "manage_users")).toBe(false);
    expect(can("warehouse", "view_operations")).toBe(true);
    expect(can("warehouse", "manage_lots")).toBe(false);
  });
});
