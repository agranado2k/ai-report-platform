import { describe, expect, it } from "vitest";
import { reportId } from "./brand";
import { looksLikeReportId, makeReportId, reportIdToWire } from "./report-id";

describe("makeReportId / reportIdToWire / looksLikeReportId", () => {
  const uuid = "019ed70f-491d-707a-a263-4c31243f0c9f";

  it("round-trips a report id through the wire codec", () => {
    const wire = reportIdToWire(reportId(uuid));
    expect(wire.startsWith("report_")).toBe(true);
    const back = makeReportId(wire);
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare UUID and a slug", () => {
    expect(makeReportId(uuid).ok).toBe(false);
    expect(makeReportId("asfSltjmfp").ok).toBe(false); // a nanoid slug is not a report id
  });

  it("looksLikeReportId discriminates a report id from a slug structurally", () => {
    expect(looksLikeReportId(reportIdToWire(reportId(uuid)))).toBe(true);
    expect(looksLikeReportId("asfSltjmfp")).toBe(false); // 10-char slug
    // a 10-char slug that coincidentally starts report_ is still too short to be an id
    expect(looksLikeReportId("report_xyz")).toBe(false);
  });
});
