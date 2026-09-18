import { describe, expect, it } from "vitest";
import { EDITOR_PANELS, type EditorPanel, readPanelHint, withPanelHint } from "./editor-panel";

describe("readPanelHint", () => {
  it.each(EDITOR_PANELS)("reads %s — every panel in the enum is hintable", (panel) => {
    expect(readPanelHint(panel)).toBe(panel);
  });

  it("is absent for a missing hint — no hint is not an error", () => {
    expect(readPanelHint(null)).toBeUndefined();
    expect(readPanelHint(undefined)).toBeUndefined();
    expect(readPanelHint("")).toBeUndefined();
  });

  it.each([
    ["an unknown tab name", "diff"],
    ["the wrong case", "Versions"],
    ["whitespace around a real one", " versions "],
    ["a comma-joined pair", "comments,versions"],
    ["a path traversal", "../../etc/passwd"],
    ["a cross-origin URL", "https://evil.example/versions"],
    ["a query-injection attempt", "versions&et=stolen"],
  ])("drops %s", (_name, raw) => {
    expect(readPanelHint(raw)).toBeUndefined();
  });

  it.each([
    ["a number", 1],
    ["an object", { panel: "versions" }],
    ["an array of a valid value", ["versions"]],
    ["a boolean", true],
  ])("drops %s — the hint arrives from a URL, so the input is unknown", (_name, raw) => {
    expect(readPanelHint(raw)).toBeUndefined();
  });
});

describe("withPanelHint", () => {
  it("opens the query when the URL has none", () => {
    expect(withPanelHint("https://view.example/abcde12345/edit", "versions")).toBe(
      "https://view.example/abcde12345/edit?panel=versions",
    );
  });

  it("extends a query the URL already carries", () => {
    expect(withPanelHint("https://app.example/reports/abcde12345/open?to=edit", "comments")).toBe(
      "https://app.example/reports/abcde12345/open?to=edit&panel=comments",
    );
  });

  it("leaves the URL untouched when there is no hint", () => {
    expect(withPanelHint("/abcde12345/edit", undefined)).toBe("/abcde12345/edit");
  });

  it("never invents a hint the enum does not contain", () => {
    // The parameter is typed, so this is the runtime half of the same claim:
    // the only way to a `panel=` in a URL is a value that came back from
    // `readPanelHint`, and that function is the enum's only door.
    for (const panel of EDITOR_PANELS) {
      const url = new URL(withPanelHint("https://view.example/abcde12345/edit", panel));
      expect(readPanelHint(url.searchParams.get("panel"))).toBe<EditorPanel>(panel);
    }
  });
});
