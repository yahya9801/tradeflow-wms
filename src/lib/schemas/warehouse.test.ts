import { describe, it, expect } from "vitest";
import { warehouseSchema, shedSchema } from "./warehouse";

describe("warehouseSchema", () => {
  it("accepts a valid warehouse", () => {
    const r = warehouseSchema.safeParse({
      name: "Harbour Terminal",
      address: "Dock Road",
      capacity_mt: "12000",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capacity_mt).toBe(12000);
  });

  it("rejects a short name", () => {
    const r = warehouseSchema.safeParse({ name: "H", address: "", capacity_mt: "100" });
    expect(r.success).toBe(false);
  });

  it("rejects zero or negative capacity", () => {
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "0" }).success).toBe(false);
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "-5" }).success).toBe(false);
  });

  it("allows an empty address", () => {
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "10" }).success).toBe(true);
  });
});

describe("shedSchema", () => {
  it("accepts a valid shed", () => {
    const r = shedSchema.safeParse({ name: "Shed A", capacity_mt: "2500" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capacity_mt).toBe(2500);
  });

  it("rejects an empty name", () => {
    expect(shedSchema.safeParse({ name: "", capacity_mt: "10" }).success).toBe(false);
  });

  it("rejects non-numeric capacity", () => {
    expect(shedSchema.safeParse({ name: "Shed A", capacity_mt: "abc" }).success).toBe(false);
  });
});
