// Node-render smoke for the selectable scope cards (#338, report §04). Pure — no
// Remix. Pins that each grant is a checkbox posting name="scopes" with the exact
// scope id (the action's create path reads repeated `scopes` entries), that
// reports:write is pre-checked, and that each card explains its grant.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScopeCards } from "./ScopeCards";

const html = renderToStaticMarkup(h(ScopeCards));

describe("ScopeCards", () => {
  it("posts both issuable scopes as name=scopes checkboxes with exact values", () => {
    expect(html).toMatch(
      /name="scopes"[^>]*value="reports:write"|value="reports:write"[^>]*name="scopes"/,
    );
    expect(html).toContain('value="acl:write"');
    expect((html.match(/name="scopes"/g) ?? []).length).toBe(2);
  });
  it("defaults reports:write checked and acl:write unchecked", () => {
    // The checked box is the reports:write one — its value appears in a checked input.
    const reportsChecked =
      /value="reports:write"[^>]*checked|checked[^>]*value="reports:write"/.test(html);
    expect(reportsChecked).toBe(true);
    const aclChecked = /value="acl:write"[^>]*checked|checked[^>]*value="acl:write"/.test(html);
    expect(aclChecked).toBe(false);
  });
  it("explains each grant", () => {
    expect(html).toContain("Upload and update reports");
    expect(html).toContain("Change sharing and grant write access");
  });
});
