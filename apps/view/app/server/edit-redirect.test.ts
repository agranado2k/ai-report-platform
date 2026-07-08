// Behavior tests for buildEditRedirectLocation — the pure URL-building step
// behind GET /<slug>/edit's 302 redirect (ADR-0063 Decision 3's dashboard-
// origin-editing fallback). No DOM/Response needed, so it's cheap to unit
// test directly, mirroring the app-side carve-out reasoning already used for
// apps/app/app/server's transport-seam helpers.
import { describe, expect, it } from "vitest";
import { buildEditRedirectLocation } from "./edit-redirect";

describe("buildEditRedirectLocation", () => {
  it("builds the app-origin edit URL from a configured appOrigin + slug", () => {
    const location = buildEditRedirectLocation("https://app.centaurspec.com", "abc1234567");
    expect(location).toBe("https://app.centaurspec.com/reports/abc1234567/edit");
  });

  it("strips a trailing slash on appOrigin before appending the path", () => {
    const location = buildEditRedirectLocation("https://app.centaurspec.com/", "abc1234567");
    expect(location).toBe("https://app.centaurspec.com/reports/abc1234567/edit");
  });

  it("returns null (fail closed) when appOrigin is unset", () => {
    expect(buildEditRedirectLocation(undefined, "abc1234567")).toBeNull();
  });
});
