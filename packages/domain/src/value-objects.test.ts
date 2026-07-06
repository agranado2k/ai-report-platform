import { describe, expect, it } from "vitest";
import { ACL_MODES, GRANT_LEVELS, isServable, SCAN_STATUSES } from "./value-objects";

describe("value objects", () => {
  it("only a clean version is servable", () => {
    expect(isServable("clean")).toBe(true);
    expect(isServable("pending")).toBe(false);
    expect(isServable("flagged")).toBe(false);
    expect(isServable("blocked")).toBe(false);
  });

  it("exposes the closed enumerations", () => {
    expect(SCAN_STATUSES).toEqual(["pending", "clean", "flagged", "blocked"]);
    expect(ACL_MODES).toEqual(["private", "public", "password", "org", "allowlist"]);
    expect(GRANT_LEVELS).toEqual(["editor", "admin"]);
  });
});
