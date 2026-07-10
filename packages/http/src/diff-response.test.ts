import { err, notFound, ok, versionId, versionIdToWire } from "arp-domain";
import { describe, expect, it } from "vitest";
import { reportDiffToHttp } from "./diff-response";

const CTX = { mode: "prod" as const };
const V1 = versionId("00000000-0000-7000-8000-0000000000e1");
const V2 = versionId("00000000-0000-7000-8000-0000000000e2");

describe("reportDiffToHttp", () => {
  it("renders a 200 report_diff resource with diff_mode distinct from the deployment mode field", () => {
    const http = reportDiffToHttp(
      ok({
        mode: "structural" as const,
        html: "<p>diff html</p>",
        label: null,
        fromVersionId: V1,
        toVersionId: V2,
        fromVersionNo: 1,
        toVersionNo: 2,
      }),
      CTX,
    );

    expect(http.status).toBe(200);
    expect(http.body).toEqual({
      object: "report_diff",
      diff_mode: "structural",
      html: "<p>diff html</p>",
      label: null,
      from: { id: versionIdToWire(V1), version_no: 1 },
      to: { id: versionIdToWire(V2), version_no: 2 },
      mode: "prod",
    });
  });

  it("passes through the fallback label", () => {
    const http = reportDiffToHttp(
      ok({
        mode: "fallback" as const,
        html: "<div>fallback</div>",
        label: "structural diff unavailable",
        fromVersionId: V1,
        toVersionId: V2,
        fromVersionNo: 1,
        toVersionNo: 2,
      }),
      CTX,
    );
    expect((http.body as { diff_mode: string }).diff_mode).toBe("fallback");
    expect((http.body as { label: string }).label).toBe("structural diff unavailable");
  });

  it("renders an error as a problem+json response", () => {
    const http = reportDiffToHttp(err(notFound("version not found")), CTX);
    expect(http.status).toBe(404);
    expect(http.contentType).toBe("application/problem+json");
  });
});
