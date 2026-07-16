import { describe, it, expect } from "vitest";
import { lotSchema, lotFormToInput } from "./lot";

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

const COMMODITY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CLIENT = "9c858901-8a57-4791-81fe-4c455b099bc9";

describe("lotFormToInput", () => {
  // Regression: an unmounted input is absent from FormData, so .get() returns
  // null. Zod's .optional() rejects null, so without normalization the form
  // could never save — in either direction — and failed silently.
  it("parses an export form where the import-only inputs were never mounted", () => {
    const fd = new FormData();
    fd.set("direction", "export");
    fd.set("commodity_id", COMMODITY);
    fd.set("client_id", CLIENT);
    fd.set("quantity_mt", "500");
    fd.set("destination_country", "Brazil");
    fd.set("export_ref", "EXP-123456");
    fd.set("payment_terms", "TT");
    // origin_country / vessel_name / bl_number are absent: not rendered.

    const r = lotSchema.safeParse(lotFormToInput(fd, "pending"));
    expect(r.success).toBe(true);
  });

  it("parses an import form where the export-only inputs were never mounted", () => {
    const fd = new FormData();
    fd.set("direction", "import");
    fd.set("commodity_id", COMMODITY);
    fd.set("client_id", CLIENT);
    fd.set("quantity_mt", "500");
    fd.set("origin_country", "India");
    fd.set("vessel_name", "MV Test 1");
    // destination_country / export_ref / payment_terms are absent.

    const r = lotSchema.safeParse(lotFormToInput(fd, "pending"));
    expect(r.success).toBe(true);
  });

  it("keeps payment terms on an import (they are not export-only)", () => {
    const fd = new FormData();
    fd.set("direction", "import");
    fd.set("commodity_id", COMMODITY);
    fd.set("client_id", CLIENT);
    fd.set("quantity_mt", "500");
    fd.set("origin_country", "India");
    fd.set("payment_terms", "LC");

    const r = lotSchema.safeParse(lotFormToInput(fd, "pending"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_terms).toBe("LC");
  });

  it("never takes status from the form", () => {
    const fd = new FormData();
    fd.set("direction", "import");
    fd.set("commodity_id", COMMODITY);
    fd.set("client_id", CLIENT);
    fd.set("quantity_mt", "500");
    fd.set("origin_country", "India");
    fd.set("status", "pending"); // a malicious client trying to dodge the B/L rule
    // The server says this lot is in transit, so the B/L rule must still bite.
    const r = lotSchema.safeParse(lotFormToInput(fd, "in_transit"));
    expect(r.success).toBe(false);
  });
});
