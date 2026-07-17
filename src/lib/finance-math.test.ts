import { describe, expect, it } from "vitest";
import { deriveStatus, isOverdue, agingBuckets } from "./finance-math";

describe("deriveStatus", () => {
  it("is pending when nothing is paid", () => expect(deriveStatus(1000, 0)).toBe("pending"));
  it("is partial when some is paid", () => expect(deriveStatus(1000, 400)).toBe("partial"));
  it("is paid at exact amount", () => expect(deriveStatus(1000, 1000)).toBe("paid"));
  it("is paid when over-covered", () => expect(deriveStatus(1000, 1200)).toBe("paid"));
  it("is pending for a zero-amount invoice with no payment", () => expect(deriveStatus(0, 0)).toBe("pending"));
});

describe("isOverdue", () => {
  const today = new Date("2026-07-17T12:00:00Z");
  it("is false with no due date", () => expect(isOverdue(null, "pending", today)).toBe(false));
  it("is false when paid", () => expect(isOverdue("2026-01-01", "paid", today)).toBe(false));
  it("is true when past due and unpaid", () => expect(isOverdue("2026-07-16", "partial", today)).toBe(true));
  it("is false when due in the future", () => expect(isOverdue("2026-08-01", "pending", today)).toBe(false));
  it("is false on the due date itself", () => expect(isOverdue("2026-07-17", "pending", today)).toBe(false));
});

describe("agingBuckets", () => {
  const today = new Date("2026-07-17T00:00:00Z");
  const day = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

  it("puts not-yet-due and null-due amounts in Current", () => {
    const b = agingBuckets(
      [{ due_date: null, outstanding: 100 }, { due_date: day(-5), outstanding: 50 }],
      today,
    );
    expect(b.find((x) => x.label === "Current")!.amount).toBe(150);
  });

  it("bucket boundaries land correctly", () => {
    const items = [
      { due_date: day(1), outstanding: 1 },    // 1–30
      { due_date: day(30), outstanding: 2 },   // 1–30
      { due_date: day(31), outstanding: 3 },   // 31–60
      { due_date: day(60), outstanding: 4 },   // 31–60
      { due_date: day(61), outstanding: 5 },   // 61–90
      { due_date: day(90), outstanding: 6 },   // 61–90
      { due_date: day(91), outstanding: 7 },   // 90+
    ];
    const b = agingBuckets(items, today);
    const by = (l: string) => b.find((x) => x.label === l)!.amount;
    expect(by("1–30")).toBe(3);
    expect(by("31–60")).toBe(7);
    expect(by("61–90")).toBe(11);
    expect(by("90+")).toBe(7);
  });

  it("buckets sum to total outstanding", () => {
    const items = [
      { due_date: null, outstanding: 10 },
      { due_date: day(5), outstanding: 20 },
      { due_date: day(45), outstanding: 30 },
      { due_date: day(200), outstanding: 40 },
    ];
    const total = agingBuckets(items, today).reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(100);
  });
});
