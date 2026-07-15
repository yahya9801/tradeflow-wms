import { describe, it, expect } from "vitest";
import { LOT_STATUSES, statusIndex, allowedTransitions } from "./lot-status";

describe("lifecycle order", () => {
  it("is the CLAUDE.md order", () => {
    expect(LOT_STATUSES).toEqual([
      "pending", "in_transit", "received", "stored", "dispatched", "delivered",
    ]);
  });

  it("indexes in order", () => {
    expect(statusIndex("pending")).toBe(0);
    expect(statusIndex("delivered")).toBe(5);
  });
});

describe("allowedTransitions — management", () => {
  it("offers only the next step", () => {
    expect(allowedTransitions("pending", false)).toEqual(["in_transit"]);
    expect(allowedTransitions("stored", false)).toEqual(["dispatched"]);
  });

  it("offers nothing at the end of the lifecycle", () => {
    expect(allowedTransitions("delivered", false)).toEqual([]);
  });

  it("never offers a backward step", () => {
    for (const s of LOT_STATUSES) {
      for (const t of allowedTransitions(s, false)) {
        expect(statusIndex(t)).toBeGreaterThan(statusIndex(s));
      }
    }
  });
});

describe("allowedTransitions — owner", () => {
  it("offers the next step plus one step back", () => {
    expect(allowedTransitions("stored", true)).toEqual(["dispatched", "received"]);
  });

  it("has no step back from the first status", () => {
    expect(allowedTransitions("pending", true)).toEqual(["in_transit"]);
  });

  it("offers only the step back at the end", () => {
    expect(allowedTransitions("delivered", true)).toEqual(["dispatched"]);
  });

  it("never offers more than two actions", () => {
    for (const s of LOT_STATUSES) {
      expect(allowedTransitions(s, true).length).toBeLessThanOrEqual(2);
    }
  });
});
