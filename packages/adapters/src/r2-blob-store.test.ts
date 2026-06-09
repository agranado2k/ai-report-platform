import { reportId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { blobKey } from "./r2-blob-store";

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
