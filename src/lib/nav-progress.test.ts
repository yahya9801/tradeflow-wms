import { describe, expect, it } from "vitest";
import { isTrackableNavigation } from "./nav-progress";

const current = { origin: "https://app.test", url: "https://app.test/lots" };
const link = (href: string, extra: Partial<{ target: string | null; hasDownload: boolean }> = {}) => ({
  href, target: null, hasDownload: false, ...extra,
});

describe("isTrackableNavigation", () => {
  it("tracks an internal link to a different route", () => {
    expect(isTrackableNavigation(link("/clients"), current, false)).toBe(true);
  });
  it("ignores an external origin", () => {
    expect(isTrackableNavigation(link("https://example.com/x"), current, false)).toBe(false);
  });
  it("ignores navigation to the current URL", () => {
    expect(isTrackableNavigation(link("/lots"), current, false)).toBe(false);
  });
  it("ignores a hash-only link on the same page", () => {
    expect(isTrackableNavigation(link("/lots#section"), current, false)).toBe(false);
  });
  it("ignores target=_blank", () => {
    expect(isTrackableNavigation(link("/clients", { target: "_blank" }), current, false)).toBe(false);
  });
  it("ignores download links", () => {
    expect(isTrackableNavigation(link("/export.csv", { hasDownload: true }), current, false)).toBe(false);
  });
  it("ignores modifier-clicks (open in new tab)", () => {
    expect(isTrackableNavigation(link("/clients"), current, true)).toBe(false);
  });
  it("tracks navigation to a different route even with a hash", () => {
    expect(isTrackableNavigation(link("/clients#top"), current, false)).toBe(true);
  });
});
