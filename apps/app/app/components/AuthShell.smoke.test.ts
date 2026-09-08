// Node-render smoke test for the auth host chrome (#339, App Shell Mockups
// Z0W60dI8hu SECTION 05). AuthShell is prop-driven and Clerk-free — the Clerk
// <SignIn>/<SignUp> card is passed in as children — so server-rendering it to a
// string exercises the whole host-chrome markup contract with no browser and no
// Clerk context. renderToStaticMarkup runs no effects; this is the SSR baseline.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthShell } from "./AuthShell";

const html = renderToStaticMarkup(h(AuthShell, null, h("div", {}, "CLERK CARD")));

describe("AuthShell", () => {
  it("draws the Centaur mark (an SVG logomark) and serif wordmark", () => {
    expect(html).toContain("Centaur");
    expect(html).toContain("<svg"); // the Logo logomark
    expect(html).toContain("font-serif"); // wordmark stays in the serif
  });

  it("renders the Clerk card as its child, BELOW the brand lockup", () => {
    expect(html).toContain("CLERK CARD");
    // The mark is above the card in the mockup: the wordmark markup precedes it.
    expect(html.indexOf("Centaur")).toBeLessThan(html.indexOf("CLERK CARD"));
  });

  it("centres a ~400px column on the page ground (section-05 width + surface)", () => {
    expect(html).toContain("max-w-[400px]");
    expect(html).toContain("bg-bg");
    expect(html).toContain("place-items-center");
  });
});
