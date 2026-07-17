import { describe, expect, it } from "vitest";
import { auditActionLabel } from "./audit-format";

describe("auditActionLabel", () => {
  it("labels known actions", () => {
    expect(auditActionLabel("create")).toBe("Created");
    expect(auditActionLabel("transition")).toBe("Status change");
  });
  it("passes through unknown actions", () => expect(auditActionLabel("frobnicate")).toBe("frobnicate"));
});
