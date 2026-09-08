// Node-render smoke for the one-time secret reveal (#338, report §04). Pure — no
// Remix. Pins the warning treatment (the key is shown once), the secret shown
// verbatim with a copy button, and the granted scopes.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreatedKeyReveal } from "./CreatedKeyReveal";

const html = renderToStaticMarkup(
  h(CreatedKeyReveal, {
    created: {
      secret: "arp_live_9f2a_secret_d41c",
      name: "Claude · laptop",
      scopes: ["reports:write"],
    },
  }),
);

describe("CreatedKeyReveal", () => {
  it("warns the key is shown once and cannot be re-displayed", () => {
    expect(html).toContain("Copy your new key now");
    expect(html.toLowerCase()).toContain("shown once");
  });
  it("uses the warning banner tone (soft warning surface)", () => {
    expect(html).toContain("warning");
  });
  it("shows the secret verbatim with a copy button", () => {
    expect(html).toContain("arp_live_9f2a_secret_d41c");
    expect(html).toMatch(/aria-label="Copy to clipboard"/);
  });
  it("lists the granted scopes and the key name", () => {
    expect(html).toContain("reports:write");
    expect(html).toContain("Claude · laptop");
  });
});
