import { describe, expect, it } from "vitest";
import { fidelityNotice } from "./fidelity-notice.server";

describe("fidelityNotice (ADR-0090, #364)", () => {
  it("says nothing for a lossless report — the editor would keep it", () => {
    expect(fidelityNotice("lossless")).toBeNull();
  });

  it("says nothing for the UNKNOWN state — a never-probed report is not lossy", () => {
    // The same behaviour-neutral rule `editabilityNotice` follows, and for the
    // same reason (ADR-0090 §4): every ReportVersion written before ADR-0090
    // reads `null` here. Announcing "we don't know" across the whole existing
    // corpus at once is noise indistinguishable from a real finding — and
    // reading `null` as lossy would be the precise inversion of the field's
    // purpose.
    expect(fidelityNotice(null)).toBeNull();
  });

  it("flags a lossy report as view-only", () => {
    const notice = fidelityNotice("lossy");
    expect(notice?.label).toBe("View-only");
  });

  it("explains that the report VIEWS fine — the cost lands on a save", () => {
    // ADR-0090 §5: fidelity explains, it never gates. A lossy report is still
    // published, still served byte-for-byte, still openable. The hint must not
    // read as "this report is broken", which is the misreading that would send
    // an author re-uploading a document that is working exactly as intended.
    const notice = fidelityNotice("lossy");
    expect(notice?.title).toMatch(/still (views|serves|opens)/i);
    expect(notice?.title).toMatch(/sav(e|ing)/i);
  });

  it("does not claim the report cannot be edited — that is the OTHER verdict", () => {
    // `editable` + `lossy` is the case ADR-0090 exists for, so this notice must
    // never borrow `editabilityNotice`'s "Not editable" language: a lossy
    // report opens in the editor perfectly well. Collapsing the two sentences
    // would re-create the fourth-enum-value mistake the ADR rejected.
    const notice = fidelityNotice("lossy");
    expect(notice?.label).not.toBe("Not editable");
    expect(notice?.title).not.toMatch(/can'?t be opened|cannot be opened/i);
  });
});
