import { describe, expect, it } from "vitest";
import { rangeBounds, marginPct } from "./report-range";

const today = new Date("2026-07-17T12:00:00Z");

describe("rangeBounds", () => {
  it("month runs from the first of the month to today", () => {
    expect(rangeBounds("month", today)).toEqual({ from: "2026-07-01", to: "2026-07-17" });
  });
  it("90d runs from 90 days ago to today", () => {
    expect(rangeBounds("90d", today)).toEqual({ from: "2026-04-18", to: "2026-07-17" });
  });
  it("all is open on both ends", () => {
    expect(rangeBounds("all", today)).toEqual({ from: null, to: null });
  });
});

describe("marginPct", () => {
  it("is profit over revenue as a percentage", () => expect(marginPct(250, 1000)).toBe(25));
  it("is zero when revenue is zero (guard)", () => expect(marginPct(-100, 0)).toBe(0));
  it("can be negative", () => expect(marginPct(-200, 1000)).toBe(-20));
});
