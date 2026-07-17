import { describe, expect, it } from "vitest";
import { preferencesSchema } from "./preferences";

const base = {
  default_currency: "USD", date_format: "DD MMM YYYY", low_stock_threshold_pct: "80",
  overdue_invoices: true, over_capacity: true, missing_bl: false,
};

describe("preferencesSchema", () => {
  it("accepts valid preferences and coerces the threshold", () => {
    const r = preferencesSchema.parse(base);
    expect(r.low_stock_threshold_pct).toBe(80);
    expect(r.missing_bl).toBe(false);
  });
  it("rejects a threshold above 100", () => {
    expect(preferencesSchema.safeParse({ ...base, low_stock_threshold_pct: "150" }).success).toBe(false);
  });
  it("rejects a threshold below 1", () => {
    expect(preferencesSchema.safeParse({ ...base, low_stock_threshold_pct: "0" }).success).toBe(false);
  });
  it("rejects an unknown currency", () => {
    expect(preferencesSchema.safeParse({ ...base, default_currency: "BTC" }).success).toBe(false);
  });
});
