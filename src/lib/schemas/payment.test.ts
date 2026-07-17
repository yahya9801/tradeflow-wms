import { describe, expect, it } from "vitest";
import { paymentSchema } from "./payment";

const base = {
  invoice_id: "22222222-2222-4222-8222-222222222222",
  amount: "500",
  paid_on: "2026-07-17",
};

describe("paymentSchema", () => {
  it("accepts a valid payment and coerces amount", () => {
    expect(paymentSchema.parse(base).amount).toBe(500);
  });
  it("rejects a non-positive amount", () => {
    expect(paymentSchema.safeParse({ ...base, amount: "-1" }).success).toBe(false);
  });
  it("rejects a missing date", () => {
    expect(paymentSchema.safeParse({ ...base, paid_on: "" }).success).toBe(false);
  });
});
