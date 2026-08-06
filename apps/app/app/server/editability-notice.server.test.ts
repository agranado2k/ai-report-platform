import { describe, expect, it } from "vitest";
import { editabilityNotice } from "./editability-notice.server";

describe("editabilityNotice (ADR-0080)", () => {
  it("says nothing for an editable report — the affordance just works", () => {
    expect(editabilityNotice("editable")).toBeNull();
  });

  it("says nothing for the UNKNOWN state — a never-probed report is not un-editable", () => {
    // This is the behaviour-neutral half of the backfill policy: every report
    // that existed before ADR-0080 reads `null` here, and must look exactly as
    // it looked yesterday. Warning on unknown would be a regression that
    // affects every existing report at once.
    expect(editabilityNotice(null)).toBeNull();
  });

  it("names the fragment case in the author's own terms", () => {
    const notice = editabilityNotice("unsplittable");
    expect(notice?.label).toBe("Not editable");
    expect(notice?.title).toMatch(/<body>/);
    // Says what to DO, not just what is wrong.
    expect(notice?.title).toMatch(/re-upload|upload a full/i);
  });

  it("names the parse case distinctly — the two failures are not interchangeable", () => {
    const unsplittable = editabilityNotice("unsplittable");
    const unparsable = editabilityNotice("unparsable");
    expect(unparsable?.label).toBe("Not editable");
    expect(unparsable?.title).not.toBe(unsplittable?.title);
  });

  it("never claims the report is broken — it still views", () => {
    for (const verdict of ["unsplittable", "unparsable"] as const) {
      // The whole point of ADR-0080: "views fine, won't edit" is a legitimate
      // state. A notice that read as an error would misdescribe a report that
      // serves perfectly.
      expect(editabilityNotice(verdict)?.title).toMatch(/still (views|opens|serves)/i);
    }
  });
});
