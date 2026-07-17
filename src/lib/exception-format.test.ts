import { describe, expect, it } from "vitest";
import { severityRank, sortBySeverity, EXCEPTION_TYPE_LABELS } from "./exception-format";

describe("severityRank", () => {
  it("orders critical < warning < notice", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("notice"));
  });
});

describe("sortBySeverity", () => {
  it("puts critical first, then by created_at desc within a severity", () => {
    const rows = [
      { severity: "warning", created_at: "2026-01-01" },
      { severity: "critical", created_at: "2026-01-01" },
      { severity: "warning", created_at: "2026-02-01" },
    ] as const;
    const sorted = sortBySeverity([...rows]);
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].created_at).toBe("2026-02-01");
  });
});

describe("EXCEPTION_TYPE_LABELS", () => {
  it("labels every enum type", () => {
    for (const t of ["weight_shortage","missing_bl","missing_payment_terms","compliance_block","overdue_invoice","low_capacity"]) {
      expect(EXCEPTION_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});
