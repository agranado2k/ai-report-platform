// Smoke test for the Checkbox primitive — server-renders it (same node-only
// pattern as arp-editor's ReportEditor.ssr.test.ts: `createElement`, no JSX
// transform needed) and asserts the native-checkbox contract the settings
// scope picker relies on: type/name/value pass through, defaultChecked marks
// the element checked, and a caller className merges with the base classes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("renders a native checkbox with name/value passthrough", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { name: "scopes", value: "acl:write" }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="scopes"');
    expect(html).toContain('value="acl:write"');
    expect(html).not.toContain("checked");
  });

  it("defaultChecked marks the box checked", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { name: "scopes", value: "reports:write", defaultChecked: true }),
    );
    expect(html).toContain("checked");
  });

  it("merges a caller className after the base classes", () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { className: "mt-1" }));
    expect(html).toContain("accent-brand");
    expect(html).toContain("mt-1");
  });
});
