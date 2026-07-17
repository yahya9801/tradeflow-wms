import { describe, expect, it } from "vitest";
import { flagSchema } from "./flag";

const base = { lot_id: "11111111-1111-4111-8111-111111111111", type: "weight_shortage", severity: "critical", description: "Short by 3 MT on discharge" };

describe("flagSchema", () => {
  it("accepts a valid manual flag", () => expect(flagSchema.safeParse(base).success).toBe(true));
  it("rejects an auto-only type", () => expect(flagSchema.safeParse({ ...base, type: "missing_bl" }).success).toBe(false));
  it("rejects a too-short description", () => expect(flagSchema.safeParse({ ...base, description: "hi" }).success).toBe(false));
  it("rejects a bad severity", () => expect(flagSchema.safeParse({ ...base, severity: "urgent" }).success).toBe(false));
});
