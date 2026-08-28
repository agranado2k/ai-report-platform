import { err, notFound, ok, versionId, versionIdToWire } from "arp-domain";
import { describe, expect, it } from "vitest";
import { reportContentToHttp } from "./content-response";

const CTX = { mode: "prod" as const };
const V = versionId("00000000-0000-7000-8000-0000000000e1");

describe("reportContentToHttp", () => {
  it("renders a 200 report_content resource carrying the stored html + version address", () => {
    const http = reportContentToHttp(
      ok({
        slug: "abc123XYZ0",
        versionId: V,
        versionNo: 3,
        contentType: "text/html; charset=utf-8",
        html: "<html><body><p>hi</p></body></html>",
      }),
      CTX,
    );

    expect(http.status).toBe(200);
    expect(http.contentType).toBe("application/json");
    expect(http.body).toEqual({
      object: "report_content",
      slug: "abc123XYZ0",
      version_id: versionIdToWire(V),
      version_no: 3,
      content_type: "text/html; charset=utf-8",
      html: "<html><body><p>hi</p></body></html>",
      mode: "prod",
    });
  });

  it("omits `source` entirely when the outcome carries none (no sidecar / not requested)", () => {
    const http = reportContentToHttp(
      ok({ slug: "s", versionId: V, versionNo: 1, contentType: "text/html", html: "<x>" }),
      CTX,
    );
    expect(Object.hasOwn(http.body as object, "source")).toBe(false);
  });

  it("includes `source` verbatim when the outcome carries the sidecar doc", () => {
    const doc = { type: "doc", content: [] };
    const http = reportContentToHttp(
      ok({ slug: "s", versionId: V, versionNo: 1, contentType: "text/html", html: "<x>", source: doc }),
      CTX,
    );
    expect((http.body as { source: unknown }).source).toEqual(doc);
  });

  it("renders an error as a problem+json response", () => {
    const http = reportContentToHttp(err(notFound("content not found")), CTX);
    expect(http.status).toBe(404);
    expect(http.contentType).toBe("application/problem+json");
  });
});
