import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { followToTerminal } from "../support/follow";

const { When, Then } = createBdd();

// Distinct step phrasing from the other smoke files so the global registry has no
// clashes. Module state is safe under workers: 1 (see playwright.config.ts).
let res: APIResponse;
/** The path the last `When` asked for — replayed by the terminal-state step so
 *  it follows the SAME journey rather than a differently-spelled one. */
let requestedPath: string;

When("I request {string} without following redirects", async ({ request }, path: string) => {
  requestedPath = path;
  res = await request.get(path, { maxRedirects: 0 });
});

Then("the gate status is {int}", async ({}, status: number) => {
  expect(res.status()).toBe(status);
});

Then("the gate redirects to {string}", async ({}, location: string) => {
  expect(res.headers().location ?? "").toContain(location);
});

// THE TERMINAL STATE, not the bounce. The two assertions above describe the
// MIDDLE of the journey — a status and a Location header — and an intermediate
// hop is exactly what this suite has twice been caught asserting while the
// defect sat on the next request (#188, ADR-0080). Here the whole chain is
// walked: the visitor must actually ARRIVE at a rendered sign-in page carrying
// their intended destination, and must not be handed the protected page's own
// markup along the way.
Then(
  "the chain ends at the sign-in page still carrying {string} as the destination",
  async ({ request }, destination: string) => {
    const terminal = await followToTerminal(request, requestedPath);
    const chain = terminal.hops.map((h) => `${h.status} ${h.url}`).join(" → ");

    expect(terminal.status, `expected the sign-in page to render; got ${chain}`).toBe(200);
    const url = new URL(terminal.url);
    expect(url.pathname, `expected to land on /sign-in; got ${chain}`).toBe("/sign-in");
    // root.tsx redirects with `?redirect_url=<intended path>`, which Clerk's
    // <SignIn> honours post-auth. Losing it drops the visitor on the dashboard
    // root after signing in — a real, silent UX regression that asserting the
    // 302 alone cannot see.
    expect(url.searchParams.get("redirect_url")).toBe(destination);
    // And the gate did not leak what it was protecting: `/upload`'s own page
    // title (upload.tsx's `meta`) must appear nowhere in what was served.
    expect(
      terminal.body,
      "the sign-in page must not carry the protected page's markup",
    ).not.toContain("Upload a report");
    expect(terminal.body).toContain("<html");
  },
);
