// The shared comment-intent option list (ticket #298): one module feeds every
// composer surface (the Comments panel's edit/reply forms and the Floating
// composer), so the two can never drift apart on labels or ordering. The
// EXHAUSTIVENESS guarantee is compile-time (`Record<Intent, string>` in the
// module breaks typecheck when the domain enum moves); what this pins at
// runtime is the part types cannot see — `note` (the domain default) leads the
// list, and every option pairs the wire value with its human label.
import { describe, expect, it } from "vitest";
import { INTENT_LABELS, INTENT_OPTIONS, INTENT_TONES } from "./intent-options";

describe("INTENT_OPTIONS", () => {
  it("lists every domain intent exactly once, note (the default) first", () => {
    expect(INTENT_OPTIONS.map((o) => o.value)).toEqual(["note", "enhancement", "add", "remove"]);
  });

  it("pairs each wire value with its human label", () => {
    for (const option of INTENT_OPTIONS) {
      expect(option.label).toBe(INTENT_LABELS[option.value]);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe("INTENT_TONES", () => {
  it("gives every intent a scannable pill tone (T8, §06)", () => {
    expect(INTENT_TONES).toEqual({
      note: "info",
      enhancement: "warning",
      add: "success",
      remove: "danger",
    });
  });

  it("covers exactly the intents the option list carries (no drift)", () => {
    expect(Object.keys(INTENT_TONES).sort()).toEqual(INTENT_OPTIONS.map((o) => o.value).sort());
  });
});
