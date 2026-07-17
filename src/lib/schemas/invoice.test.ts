import { describe, expect, it } from "vitest";
import { invoiceSchema } from "./invoice";

const base = {
  type: "receivable",
  client_id: "11111111-1111-4111-8111-111111111111",
  amount: "1500.50",
};

describe("invoiceSchema", () => {
  it("accepts a minimal valid invoice and coerces amount", () => {
    const r = invoiceSchema.parse(base);
    expect(r.amount).toBe(1500.5);
    expect(r.currency).toBe("USD");
    expect(r.lot_id).toBe("");
  });
  it("rejects a non-positive amount", () => {
    expect(invoiceSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
  });
  it("rejects a bad type", () => {
    expect(invoiceSchema.safeParse({ ...base, type: "invoice" }).success).toBe(false);
  });
  it("rejects a missing client", () => {
    expect(invoiceSchema.safeParse({ ...base, client_id: "" }).success).toBe(false);
  });
  it("allows an empty lot_id and due_date", () => {
    const r = invoiceSchema.parse({ ...base, lot_id: "", due_date: "" });
    expect(r.lot_id).toBe("");
    expect(r.due_date).toBe("");
  });
});
