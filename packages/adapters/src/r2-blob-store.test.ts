import { reportId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { blobKey, withPrefix } from "./r2-blob-store";

describe("blobKey", () => {
  it("builds the ADR-0037 key: reports/<reportId>/<versionId>/<path>", () => {
    expect(blobKey(reportId("r1"), versionId("v1"), "index.html")).toBe("reports/r1/v1/index.html");
  });

  it("preserves nested paths within the bundle", () => {
    expect(blobKey(reportId("r1"), versionId("v1"), "assets/app.css")).toBe(
      "reports/r1/v1/assets/app.css",
    );
  });
});

describe("withPrefix (preview key isolation)", () => {
  const key = "reports/r1/v1/index.html";

  it("leaves the key unchanged in production (undefined/empty prefix)", () => {
    expect(withPrefix(undefined, key)).toBe(key);
    expect(withPrefix("", key)).toBe(key);
  });

  it("namespaces the key under a preview prefix", () => {
    expect(withPrefix("pr-42/", key)).toBe("pr-42/reports/r1/v1/index.html");
  });

  it("normalizes leading/trailing slashes on the prefix", () => {
    expect(withPrefix("pr-42", key)).toBe("pr-42/reports/r1/v1/index.html");
    expect(withPrefix("/pr-42/", key)).toBe("pr-42/reports/r1/v1/index.html");
  });
});
