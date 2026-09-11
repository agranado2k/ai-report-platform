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
        editability: "editable",
        fidelity: "lossy",
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
      editability: "editable",
      fidelity: "lossy",
      mode: "prod",
    });
  });

  it("omits `source` entirely when the outcome carries none (no sidecar / not requested)", () => {
    const http = reportContentToHttp(
      ok({
        slug: "s",
        versionId: V,
        versionNo: 1,
        contentType: "text/html",
        html: "<x>",
        editability: null,
        fidelity: null,
      }),
      CTX,
    );
    expect(Object.hasOwn(http.body as object, "source")).toBe(false);
  });

  it("includes `source` verbatim when the outcome carries the sidecar doc", () => {
    const doc = { type: "doc", content: [] };
    const http = reportContentToHttp(
      ok({
        slug: "s",
        versionId: V,
        versionNo: 1,
        contentType: "text/html",
        html: "<x>",
        editability: null,
        fidelity: null,
        source: doc,
      }),
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

describe("reportContentToHttp — Editability beside Fidelity", () => {
  it("carries the served version's editability next to its fidelity", () => {
    // The content read is the one surface that carried the retention verdict
    // ("would edits keep this?") without the open-time one ("can it be opened
    // at all?"). A consumer of THIS resource could see that a save would be
    // lossy but not that the editor cannot open the document in the first
    // place — the strictly more basic fact. Report, version and content reads
    // now carry the same pair.
    const http = reportContentToHttp(
      ok({
        slug: "abc123XYZ0",
        versionId: V,
        versionNo: 3,
        contentType: "text/html",
        html: "<x>",
        editability: "editable",
        fidelity: "lossy",
      }),
      CTX,
    );
    const body = http.body as { editability?: unknown; fidelity?: unknown };
    expect(body.editability).toBe("editable");
    expect(body.fidelity).toBe("lossy");
  });

  it("emits `editability: null` for the UNKNOWN state, never omits it", () => {
    // Same rule as fidelity, for the same reason: a missing key would collapse
    // "never probed" into a positive verdict.
    const http = reportContentToHttp(
      ok({
        slug: "s",
        versionId: V,
        versionNo: 1,
        contentType: "text/html",
        html: "<x>",
        editability: null,
        fidelity: null,
      }),
      CTX,
    );
    expect(Object.hasOwn(http.body as object, "editability")).toBe(true);
    expect((http.body as { editability?: unknown }).editability).toBeNull();
  });

  it("carries `unparsable` — the case fidelity alone cannot express", () => {
    // editability `unparsable` + fidelity `null` is exactly the state the
    // content read previously rendered as a bare `fidelity: null`, which is
    // indistinguishable from "editable but never probed".
    const http = reportContentToHttp(
      ok({
        slug: "s",
        versionId: V,
        versionNo: 1,
        contentType: "text/html",
        html: "<x>",
        editability: "unparsable",
        fidelity: null,
      }),
      CTX,
    );
    const body = http.body as { editability?: unknown; fidelity?: unknown };
    expect(body.editability).toBe("unparsable");
    expect(body.fidelity).toBeNull();
  });
});

describe("reportContentToHttp — Fidelity (ADR-0090)", () => {
  it("emits `fidelity: null` for the UNKNOWN state, never omits it", () => {
    // `source` is the ONE key this resource drops, because its absence is
    // itself the answer ("no sidecar"). Fidelity is not like that: dropping it
    // would make UNKNOWN indistinguishable from `lossless`.
    const http = reportContentToHttp(
      ok({
        slug: "s",
        versionId: V,
        versionNo: 1,
        contentType: "text/html",
        html: "<x>",
        editability: null,
        fidelity: null,
      }),
      CTX,
    );
    expect(Object.hasOwn(http.body as object, "fidelity")).toBe(true);
    expect((http.body as { fidelity?: unknown }).fidelity).toBeNull();
  });
});
