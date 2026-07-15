import { describe, it, expect } from "vitest";
import { lotSchema } from "./lot";

const base = {
  direction: "import",
  commodity_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  client_id: "9c858901-8a57-4791-81fe-4c455b099bc9",
  quantity_mt: "500",
  status: "pending",
  origin_country: "India",
  vessel_name: "MV Test 1",
  bl_number: "",
  payment_terms: "LC",
  notes: "",
};

describe("lotSchema", () => {
  it("accepts a valid pending import with no B/L yet", () => {
    const r = lotSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity_mt).toBe(500);
  });

  it("rejects zero or negative quantity", () => {
    expect(lotSchema.safeParse({ ...base, quantity_mt: "0" }).success).toBe(false);
    expect(lotSchema.safeParse({ ...base, quantity_mt: "-1" }).success).toBe(false);
  });

  // The paperwork doesn't exist until it sails: no B/L needed while pending,
  // required from in_transit onward.
  it("requires a B/L for an import at in_transit or later", () => {
    expect(lotSchema.safeParse({ ...base, status: "in_transit" }).success).toBe(false);
    expect(lotSchema.safeParse({ ...base, status: "stored" }).success).toBe(false);
    expect(
      lotSchema.safeParse({ ...base, status: "in_transit", bl_number: "BL-123" }).success,
    ).toBe(true);
  });

  it("does not require a B/L for exports", () => {
    expect(
      lotSchema.safeParse({
        ...base, direction: "export", status: "in_transit",
        destination_country: "Brazil", payment_terms: "TT",
      }).success,
    ).toBe(true);
  });

  it("requires payment terms for exports", () => {
    const r = lotSchema.safeParse({
      ...base, direction: "export", destination_country: "Brazil", payment_terms: "",
    });
    expect(r.success).toBe(false);
  });

  it("does not require payment terms for imports", () => {
    expect(lotSchema.safeParse({ ...base, payment_terms: "" }).success).toBe(true);
  });

  it("rejects an id that is not a uuid", () => {
    expect(lotSchema.safeParse({ ...base, commodity_id: "not-a-uuid" }).success).toBe(false);
    expect(lotSchema.safeParse({ ...base, client_id: "12345" }).success).toBe(false);
  });
});
