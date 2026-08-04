// The `security-headers` CI gate (ADR-013, ADR-026's doc-trigger matrix).
//
// WHY THIS FILE EXISTS: `docs/spec.html`'s CI table has claimed a
// `security-headers` required check — "curl against the PR's viewer preview;
// asserts the full header stack (ADR-013)" — since the spec was written, and
// it did not exist in `.github/workflows/`. Every other row in that table maps
// to a real workflow; this one was a false claim in the contract document.
// Built here rather than deleted (ADR-0062 Amendment 3): `viewHeaders()` is
// unit-tested to death, but nothing verified that what the EDGE actually
// serves matches it — a Vercel/Cloudflare layer stripping or rewriting a
// header is invisible to a unit test, and is exactly the drift the spec row
// promised to catch.
//
// It asserts against the SAME exported constants the app serves, by calling
// `viewHeaders()` here rather than restating the expected strings — a
// hardcoded copy in a shell script would drift from the source the first time
// a directive changed, which is the failure mode this file is meant to close,
// not reproduce.
//
// Skipped unless `VIEW_BASE_URL` is set, so `pnpm test` stays hermetic
// (ADR-019 puts live-infrastructure assertions in the preview-driven tier).
// `.github/workflows/security-headers.yml` supplies it, invoked by
// `preview-isolation.yml` with the same isolated `view_url` the e2e smoke
// already uses.
import { describe, expect, it } from "vitest";
import { viewHeaders } from "./view-headers";

const VIEW_BASE_URL = process.env.VIEW_BASE_URL;

/** Split a possibly-multi-value CSP header into its individual policies.
 *  `Headers.get()` joins repeated values with ", " (WHATWG Fetch), and the
 *  viewer deliberately sends TWO `Content-Security-Policy` values (the
 *  enforcing policy and the separate `sandbox` policy). */
const policies = (value: string | null): string[] =>
  (value ?? "")
    .split(", ")
    .map((p) => p.trim())
    .filter(Boolean);

describe.skipIf(!VIEW_BASE_URL)("security-headers gate — live viewer preview", () => {
  const expected = viewHeaders();

  async function fetchViewerHeaders(): Promise<Headers> {
    // `/health` is a real viewer route that goes through the same
    // `secureHeaders()` helper as `/<slug>` but needs no seeded report, so the
    // gate has no data dependency on the e2e fixtures.
    const response = await fetch(`${VIEW_BASE_URL}/health`, { redirect: "manual" });
    expect(response.status).toBeLessThan(400);
    return response.headers;
  }

  it("serves BOTH CSP values — the enforcing policy and the separate sandbox policy", async () => {
    const served = policies((await fetchViewerHeaders()).get("Content-Security-Policy"));
    const want = policies(expected.get("Content-Security-Policy"));
    expect(served.sort()).toEqual(want.sort());
  });

  it("serves the sandbox policy with exactly the tokens the source grants", async () => {
    const sandboxOf = (h: Headers) =>
      policies(h.get("Content-Security-Policy")).find((p) => p.startsWith("sandbox")) ?? "";
    expect(sandboxOf(await fetchViewerHeaders())).toBe(sandboxOf(expected));
  });

  it("serves the report-only shadow policy unchanged", async () => {
    const served = await fetchViewerHeaders();
    expect(served.get("Content-Security-Policy-Report-Only")).toBe(
      expected.get("Content-Security-Policy-Report-Only"),
    );
  });

  it("serves the isolation + hardening headers unchanged (COOP/CORP/OAC/Referrer/PP/nosniff/HSTS)", async () => {
    const served = await fetchViewerHeaders();
    for (const header of [
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Origin-Agent-Cluster",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Content-Type-Options",
      "Strict-Transport-Security",
    ]) {
      expect(`${header}: ${served.get(header)}`).toBe(`${header}: ${expected.get(header)}`);
    }
  });
});
