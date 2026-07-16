import { describe, it, expect } from "vitest";
import { clientSchema } from "./client";

const base = {
  name: "Acme Foods",
  type: "buyer",
  country: "Brazil",
  contact_name: "Ada Lin",
  email: "ada@acme.example",
  phone: "+55 11 5555 0000",
  currency: "USD",
};

describe("clientSchema", () => {
  it("accepts a valid client", () => {
    const r = clientSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects a short name", () => {
    expect(clientSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
  });

  it("rejects an invalid type", () => {
    expect(clientSchema.safeParse({ ...base, type: "vendor" }).success).toBe(false);
  });

  it("accepts each valid type", () => {
    for (const type of ["buyer", "supplier", "both"]) {
      expect(clientSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it("rejects a malformed email but allows an empty one", () => {
    expect(clientSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(clientSchema.safeParse({ ...base, email: "" }).success).toBe(true);
  });

  it("defaults currency to USD when absent", () => {
    const { email, currency, ...noCurrency } = base;
    void email;
    void currency;
    const r = clientSchema.safeParse(noCurrency);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USD");
  });
});
