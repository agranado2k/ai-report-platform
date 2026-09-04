// Pure-logic tests for the dashboard's filter-as-you-type (#334). No DOM: the
// URL the typed query navigates to, and the "/" focus-key match, are plain
// functions so the client island stays a thin wrapper.
import { describe, expect, it } from "vitest";
import { filterNavTarget, isFilterFocusKey } from "./report-filter";

describe("filterNavTarget", () => {
  it("sets ?q= and PRESERVES the folder filter", () => {
    expect(filterNavTarget("?folder=f1", "sales")).toBe("/?folder=f1&q=sales");
  });
  it("drops ?q= entirely when the query is blank (not q=)", () => {
    expect(filterNavTarget("?q=old&folder=f1", "  ")).toBe("/?folder=f1");
    expect(filterNavTarget("?q=old", "")).toBe("/");
  });
  it("RESETS cursor pagination — a new filter must start at page 1", () => {
    expect(filterNavTarget("?q=a&starting_after=X&ending_before=Y", "b")).toBe("/?q=b");
  });
  it("trims the query and keeps interior spaces", () => {
    expect(filterNavTarget("", "  q3 plan  ")).toBe("/?q=q3+plan");
  });
});

describe("isFilterFocusKey", () => {
  it('is a bare "/" with no modifier and not already in a field', () => {
    expect(
      isFilterFocusKey({ key: "/", metaKey: false, ctrlKey: false, altKey: false }, false),
    ).toBe(true);
  });
  it("ignores it while typing in a field, or with a modifier", () => {
    expect(
      isFilterFocusKey({ key: "/", metaKey: false, ctrlKey: false, altKey: false }, true),
    ).toBe(false);
    expect(
      isFilterFocusKey({ key: "/", metaKey: true, ctrlKey: false, altKey: false }, false),
    ).toBe(false);
    expect(
      isFilterFocusKey({ key: "a", metaKey: false, ctrlKey: false, altKey: false }, false),
    ).toBe(false);
  });
});
