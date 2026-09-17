// What the viewer's CSP will refuse to load — asked at write time (ticket #365).
//
// The load-bearing property these tests pin is that the scan reads the ONE
// Viewer CSP allowlist (ADR-0088) rather than a copy of its hosts: every
// assertion about an allowed host derives from `VIEW_CSP_ALLOWLIST` itself, so
// widening the allowlist widens the scanner in the same commit, and narrowing
// it narrows the scanner — neither can drift without this file failing.

import { VIEW_CSP_ALLOWLIST } from "arp-headers/view";
import { describe, expect, it, vi } from "vitest";
import { scanBlockedResources } from "./resource-scan.js";

const doc = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const urls = (html: string) => scanBlockedResources(html).map((r) => r.url);

describe("scanBlockedResources", () => {
  describe("the allowlist is the single source of truth (ADR-0088)", () => {
    it("clears every script-src host on the allowlist", () => {
      for (const host of VIEW_CSP_ALLOWLIST.scriptSrc) {
        expect(urls(doc(`<script src="${host}/lib@1.2.3/dist/lib.min.js"></script>`))).toEqual([]);
      }
    });

    it("clears every style-src host on the allowlist", () => {
      for (const host of VIEW_CSP_ALLOWLIST.styleSrc) {
        expect(urls(doc("", `<link rel="stylesheet" href="${host}/css2?family=Inter">`))).toEqual(
          [],
        );
      }
    });

    it("clears every font-src host on the allowlist, reached through @font-face", () => {
      for (const host of VIEW_CSP_ALLOWLIST.fontSrc) {
        const style = `<style>@font-face{font-family:X;src:url(${host}/s/inter/v1/a.woff2) format('woff2');}</style>`;
        expect(urls(doc("", style))).toEqual([]);
      }
    });

    it("reports the directive's own allowed hosts on a blocked resource, not a copy", () => {
      const [blocked] = scanBlockedResources(doc('<script src="https://unpkg.com/x.js"></script>'));
      expect(blocked).toEqual({
        url: "https://unpkg.com/x.js",
        directive: "script-src",
        allowed: VIEW_CSP_ALLOWLIST.scriptSrc,
      });
    });
  });

  describe("what counts as blocked", () => {
    it("blocks a script from a host that is not on the allowlist", () => {
      expect(urls(doc('<script src="https://evil.test/a.js"></script>'))).toEqual([
        "https://evil.test/a.js",
      ]);
    });

    it("honours the allowlist's PATH prefix — jsdelivr /npm/ is allowed, /gh/ is not", () => {
      expect(urls(doc('<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.js"></script>'))) //
        .toEqual([]);
      expect(urls(doc('<script src="https://cdn.jsdelivr.net/gh/u/r/x.js"></script>'))).toEqual([
        "https://cdn.jsdelivr.net/gh/u/r/x.js",
      ]);
    });

    it("resolves . and .. the way a browser does BEFORE matching the prefix", () => {
      // CSP matches the RESOLVED URL, so `/npm/../gh/x.js` is `/gh/x.js` —
      // outside jsdelivr's allowlisted `/npm/` prefix, and blocked. Matching
      // the string as written would clear it and lose the warning.
      const escaped = "https://cdn.jsdelivr.net/npm/../gh/user/repo/x.js";
      expect(urls(doc(`<script src="${escaped}"></script>`))).toEqual([escaped]);
    });

    it("resolves the percent-encoded dot segments too", () => {
      // `%2e%2e` is a dot-dot segment to a URL parser, so it escapes the
      // prefix exactly as `..` does — and is the form someone probing would
      // reach for first.
      const escaped = "https://cdn.jsdelivr.net/npm/%2e%2e/gh/user/repo/x.js";
      expect(urls(doc(`<script src="${escaped}"></script>`))).toEqual([escaped]);
    });

    it("clears a path whose dot segments resolve back INSIDE the prefix", () => {
      // The rule is resolution, not "reject anything containing `..`":
      // `/npm/pkg/../dist/x.js` is `/npm/dist/x.js`, which the allowlist allows.
      expect(urls(doc('<script src="https://cdn.jsdelivr.net/npm/pkg/../dist/x.js"></script>'))) //
        .toEqual([]);
    });

    it("is directive-aware: a script CDN is not an image source", () => {
      // `img-src 'self' data: blob:` is pinned (ADR-0088) — a wildcard image
      // source is an exfiltration channel, so no allowlist host applies here.
      const [blocked] = scanBlockedResources(
        doc('<img src="https://cdnjs.cloudflare.com/logo.png">'),
      );
      expect(blocked).toEqual({
        url: "https://cdnjs.cloudflare.com/logo.png",
        directive: "img-src",
        allowed: [],
      });
    });

    it("blocks an iframe from any external host — frame-src falls back to default-src 'self'", () => {
      expect(scanBlockedResources(doc('<iframe src="https://example.test/x"></iframe>'))).toEqual([
        { url: "https://example.test/x", directive: "frame-src", allowed: [] },
      ]);
    });

    it("blocks an external stylesheet link", () => {
      expect(
        scanBlockedResources(doc("", '<link rel="stylesheet" href="https://unpkg.com/a.css">')),
      ).toEqual([
        {
          url: "https://unpkg.com/a.css",
          directive: "style-src",
          allowed: VIEW_CSP_ALLOWLIST.styleSrc,
        },
      ]);
    });

    it("blocks an @import in a <style> block", () => {
      const style = '<style>@import url("https://evil.test/theme.css");</style>';
      expect(scanBlockedResources(doc("", style))).toEqual([
        {
          url: "https://evil.test/theme.css",
          directive: "style-src",
          allowed: VIEW_CSP_ALLOWLIST.styleSrc,
        },
      ]);
    });

    it("blocks the QUOTED @import form, which carries no url()", () => {
      const style = `<style>@import "https://evil.test/theme.css";</style>`;
      expect(urls(doc("", style))).toEqual(["https://evil.test/theme.css"]);
    });

    it("attributes EVERY @font-face block, including identical repeats, to font-src", () => {
      // A string-needle removal only takes out the first occurrence, which
      // would leave the duplicate behind to be miscounted as an image source.
      const block = "@font-face{font-family:X;src:url(https://evil.test/x.woff2);}";
      expect(scanBlockedResources(doc("", `<style>${block}${block}</style>`))).toEqual([
        {
          url: "https://evil.test/x.woff2",
          directive: "font-src",
          allowed: VIEW_CSP_ALLOWLIST.fontSrc,
        },
      ]);
    });

    it("blocks a non-allowlisted @font-face source as font-src", () => {
      const style = "<style>@font-face{font-family:X;src:url(https://evil.test/x.woff2);}</style>";
      expect(scanBlockedResources(doc("", style))).toEqual([
        {
          url: "https://evil.test/x.woff2",
          directive: "font-src",
          allowed: VIEW_CSP_ALLOWLIST.fontSrc,
        },
      ]);
    });

    it("blocks a url() outside @font-face as img-src", () => {
      const style = "<style>.hero{background:url(https://cdn.test/bg.png) no-repeat;}</style>";
      expect(scanBlockedResources(doc("", style))).toEqual([
        { url: "https://cdn.test/bg.png", directive: "img-src", allowed: [] },
      ]);
    });

    it("blocks a url() in a style ATTRIBUTE", () => {
      expect(urls(doc(`<div style="background:url('https://cdn.test/a.png')"></div>`))).toEqual([
        "https://cdn.test/a.png",
      ]);
    });

    it("blocks every candidate in an img srcset", () => {
      expect(
        urls(doc('<img srcset="https://cdn.test/a.png 1x, https://cdn.test/b.png 2x" alt="">')),
      ).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
    });

    describe("srcset follows the HTML candidate grammar, not a split on commas", () => {
      // A candidate is a URL then an optional descriptor, and the URL token
      // runs to the next ASCII whitespace — so a comma INSIDE a URL belongs to
      // it. Splitting on every comma invents references the document never
      // makes and loses the one it does.
      it("keeps a candidate URL that itself contains commas", () => {
        const transform = "https://cdn.test/image/w_400,h_300,c_fill/a.png";
        expect(urls(doc(`<img srcset="${transform} 2x" alt="">`))).toEqual([transform]);
      });

      it("separates candidates on the comma that terminates a descriptor", () => {
        const html = doc(
          '<img srcset="https://cdn.test/x,1/a.png 1x,https://cdn.test/x,2/b.png 2x" alt="">',
        );
        expect(urls(html)).toEqual(["https://cdn.test/x,1/a.png", "https://cdn.test/x,2/b.png"]);
      });

      it("separates candidates on a comma glued to a URL with no descriptor", () => {
        const html = doc('<img srcset="https://cdn.test/a.png, https://cdn.test/b.png" alt="">');
        expect(urls(html)).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
      });

      it("reads a comma-joined pair with no whitespace as the ONE URL a browser fetches", () => {
        // The notorious corner of the grammar: with no whitespace after the
        // comma there is no candidate boundary, so the whole string is one URL
        // token. That single mangled request is what the viewer actually
        // makes, so it is what the author should be told about.
        const html = doc('<img srcset="https://cdn.test/a.png,https://cdn.test/b.png" alt="">');
        expect(urls(html)).toEqual(["https://cdn.test/a.png,https://cdn.test/b.png"]);
      });

      it("does not split on a comma inside a descriptor's parentheses", () => {
        const html = doc('<img srcset="https://cdn.test/a.png (min-width:1px,2px) 1x" alt="">');
        expect(urls(html)).toEqual(["https://cdn.test/a.png"]);
      });

      it("tolerates empty candidates and runs of separators", () => {
        const html = doc('<img srcset=" , ,https://cdn.test/a.png 1x , , " alt="">');
        expect(urls(html)).toEqual(["https://cdn.test/a.png"]);
      });

      it("reads source[srcset] by the same grammar", () => {
        const transform = "https://cdn.test/w_1,h_2/a.png";
        const html = doc(`<picture><source srcset="${transform} 1x"><img src="" alt=""></picture>`);
        expect(urls(html)).toEqual([transform]);
      });
    });

    it("treats a protocol-relative URL as https", () => {
      expect(urls(doc('<script src="//cdnjs.cloudflare.com/a.js"></script>'))).toEqual([]);
      expect(urls(doc('<script src="//evil.test/a.js"></script>'))).toEqual(["//evil.test/a.js"]);
    });

    it("matches the host case-insensitively but reports the URL as written", () => {
      expect(urls(doc('<script src="HTTPS://CDNJS.CLOUDFLARE.COM/a.js"></script>'))).toEqual([]);
    });

    it("reports one warning per distinct URL, in document order", () => {
      const html = doc(
        '<script src="https://evil.test/a.js"></script>' +
          '<script src="https://evil.test/a.js"></script>' +
          '<script src="https://evil.test/b.js"></script>',
      );
      expect(urls(html)).toEqual(["https://evil.test/a.js", "https://evil.test/b.js"]);
    });
  });

  describe("what is deliberately NOT a warning", () => {
    it("says nothing about a self-contained document", () => {
      const html = doc(
        "<h1>Report</h1><p>All inline.</p>",
        "<style>body{font-family:system-ui}</style><script>console.log(1)</script>",
      );
      expect(scanBlockedResources(html)).toEqual([]);
    });

    it("says nothing about data: URIs", () => {
      const html = doc(
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">',
        "<style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style>",
      );
      expect(scanBlockedResources(html)).toEqual([]);
    });

    it("says nothing about same-document references", () => {
      const html = doc(
        '<a href="#summary">jump</a><svg><rect fill="url(#grad)"/></svg><img src="" alt="">',
        '<link rel="stylesheet" href="?v=2">',
      );
      expect(scanBlockedResources(html)).toEqual([]);
    });

    it("says nothing about relative or host-relative references", () => {
      const html = doc(
        '<img src="./logo.png" alt=""><script src="/assets/app.js"></script>',
        '<link rel="stylesheet" href="theme.css">',
      );
      expect(scanBlockedResources(html)).toEqual([]);
    });

    it("says nothing about non-fetching schemes", () => {
      const html = doc(
        '<a href="mailto:a@b.test">mail</a><a href="tel:+1">call</a>' +
          '<img src="blob:https://view.test/abc" alt="">',
      );
      expect(scanBlockedResources(html)).toEqual([]);
    });

    it("ignores link rels that load nothing", () => {
      const head =
        '<link rel="preconnect" href="https://evil.test">' +
        '<link rel="dns-prefetch" href="https://evil.test">' +
        '<link rel="canonical" href="https://evil.test/x">';
      expect(scanBlockedResources(doc("", head))).toEqual([]);
    });
  });

  describe("the view origin is 'self' (ADR-0088 — every viewer directive carries 'self')", () => {
    // A report is served FROM the view origin, and every fetch directive in the
    // ADR-0088 policy starts with `'self'` — so an author who writes the view
    // origin out in full is referencing a resource that actually loads. The
    // scan has to be told what that origin is; it cannot infer it from bytes.
    const VIEW = "https://view.centaurspec.com";
    const onView = (html: string) =>
      scanBlockedResources(html, { viewOrigin: VIEW }).map((r) => r.url);

    it("says nothing about an absolute URL written on the view origin", () => {
      const html = doc(
        `<img src="${VIEW}/logo.png" alt=""><script src="${VIEW}/app.js"></script>` +
          `<iframe src="${VIEW}/other" title="o"></iframe>`,
        `<link rel="stylesheet" href="${VIEW}/theme.css">` +
          `<style>@font-face{src:url(${VIEW}/inter.woff2)}body{background:url(${VIEW}/bg.png)}</style>`,
      );
      expect(onView(html)).toEqual([]);
    });

    it("compares the ORIGIN, not the host — another scheme or port is not 'self'", () => {
      const html = doc(
        '<img src="http://view.centaurspec.com/logo.png" alt="">' +
          '<img src="https://view.centaurspec.com:8443/logo.png" alt="">',
      );
      expect(onView(html)).toEqual([
        "http://view.centaurspec.com/logo.png",
        "https://view.centaurspec.com:8443/logo.png",
      ]);
    });

    it("treats a protocol-relative reference to the view host as 'self'", () => {
      expect(onView(doc('<img src="//view.centaurspec.com/logo.png" alt="">'))).toEqual([]);
    });

    it("still blocks every other origin when the view origin is known", () => {
      expect(onView(doc('<img src="https://cdn.test/a.png" alt="">'))).toEqual([
        "https://cdn.test/a.png",
      ]);
    });

    it("warns about an absolute self URL when the deployment's view origin is unknown", () => {
      // Previews and dev leave `VIEW_ORIGIN` unset. The scan then says only
      // what it can prove: with no origin to compare against, an absolute URL
      // is external. An extra advisory line beats a wrong clearance.
      expect(urls(doc(`<img src="${VIEW}/logo.png" alt="">`))).toEqual([`${VIEW}/logo.png`]);
    });

    it("ignores a view origin it cannot parse rather than throwing", () => {
      expect(
        scanBlockedResources(doc('<img src="https://cdn.test/a.png" alt="">'), {
          viewOrigin: "not a url",
        }).map((r) => r.url),
      ).toEqual(["https://cdn.test/a.png"]);
    });
  });

  describe("it is a scan, never a fetch (ADR-0069)", () => {
    it("never touches the network for a document full of external references", () => {
      const fetchSpy = vi.fn();
      const original = globalThis.fetch;
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      try {
        scanBlockedResources(
          doc(
            '<script src="https://evil.test/a.js"></script><img src="https://evil.test/b.png" alt="">',
            '<link rel="stylesheet" href="https://evil.test/c.css">',
          ),
        );
      } finally {
        globalThis.fetch = original;
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("stays linear on a large hostile stylesheet instead of backtracking", () => {
      // The scan runs over an UNTRUSTED document, so its cost has to be linear
      // in the input: an unterminated `url(` repeated across a big stylesheet
      // is the shape that makes a naive scan quadratic.
      const hostile = `<style>${"url(".repeat(20000)}${"a".repeat(20000)}</style>`;
      const started = Date.now();
      expect(() => scanBlockedResources(doc("", hostile))).not.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it("answers for malformed, hostile-looking bytes instead of throwing", () => {
      expect(() => scanBlockedResources("<<>><html><body><script src=")).not.toThrow();
      expect(() => scanBlockedResources("")).not.toThrow();
    });
  });
});
