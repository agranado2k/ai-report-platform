// Node-render smoke for the Settings tabs row (#338, report §04). Pure — no
// Remix. Pins that "API keys & MCP" is the one selected tab and Members/Billing
// are disabled "Soon" placeholders (not yet real sections).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsTabs } from "./SettingsTabs";

const html = renderToStaticMarkup(h(SettingsTabs));

describe("SettingsTabs", () => {
  it("is a tablist with API keys & MCP selected", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>[^<]*|API keys/);
    expect(html).toContain("API keys");
  });
  it("shows Members and Billing as disabled Soon placeholders", () => {
    expect(html).toContain("Members");
    expect(html).toContain("Billing");
    expect(html).toContain("disabled");
    expect(html).toContain("Soon");
  });
  it("marks the two placeholders aria-disabled, not the live tab", () => {
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-selected="true"');
  });
});
