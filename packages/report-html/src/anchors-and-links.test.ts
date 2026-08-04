// Anchor + link fidelity (ADR-0062 Amendment 3). Before this suite the editor
// round-trip silently destroyed both halves of "a link behaves like a link":
// `id` survived only on `<section>` (so `<h2 id="summary">` became `<h2>` and
// every `#summary` TOC entry became a dead anchor after ONE save), and the
// `link` mark carried only `href`/`title` (so `target`/`rel` were erased on
// every save). ADR-0062's own decision driver — "any class or attribute
// silently dropped by the editor is a product regression" — makes both bugs,
// not design.
//
// WHY A NEW FIXTURE: every one of the 9 ids in `fixtures/ai-readiness-report.html`
// sits on a `<section>`, which `sectionNode` already retained — a suite built on
// that fixture passes identically before and after the fix and proves nothing.
// `fixtures/anchors-and-links.html` puts ids on `<h2>`/`<h3>`/`<p>`/`<div>`/
// `<li>`/`<td>`/`<blockquote>` (each of which resolves to a DIFFERENT node spec
// with a DIFFERENT `toDOM` shape) and exercises the `target`/`rel` variants.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";
import { getDomEnvironmentDocument } from "./dom-environment.js";
import { reportSchema } from "./schema.js";
import { splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "./fixtures/anchors-and-links.html");
const LEGACY_FIXTURE_PATH = path.resolve(__dirname, "./fixtures/ai-readiness-report.html");

/** Round-trip a body-HTML fragment through the editor's own parse→serialize
 *  path — exactly what an edit-save does (ADR-0062 §5). */
const roundTrip = (bodyHtml: string): string => serializeBody(parseBody(bodyHtml));

const fixtureBody = () => splitShell(readFileSync(FIXTURE_PATH, "utf-8")).bodyHtml;

/** Every `id` value present in an HTML string, in document order. */
function idsIn(html: string): string[] {
  const ids: string[] = [];
  const re = /\sid="([^"]*)"/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((m = re.exec(html))) ids.push(m[1] ?? "");
  return ids;
}

describe("id retention across every node spec (ADR-0062 Amendment 3)", () => {
  // One case per DISTINCT `toDOM` shape in the schema — that's what makes this
  // table meaningful: each row exercises a different code path through the
  // `withId` sweep, not a different tag name.
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["<h2> — heading, withClassStyle-wrapped array spec", '<h2 id="a">H</h2>', "a"],
    ["<h3 class> — heading keeping BOTH class and id", '<h3 class="sub" id="b">H</h3>', "b"],
    ["<p> — paragraph, rebuilt by withParagraphVariant", '<p id="c">t</p>', "c"],
    ["<div> — htmlBlock catch-all", '<div id="d"><p>t</p></div>', "d"],
    ["<div class=card> — dedicated block node", '<div class="card" id="e"><p>t</p></div>', "e"],
    ["<blockquote>", '<blockquote id="f"><p>t</p></blockquote>', "f"],
    ["<li> — list_item", '<ul><li id="g"><p>t</p></li></ul>', "g"],
    [
      "<td> — table cell",
      '<div class="tablewrap"><table><tbody><tr><td id="h">t</td></tr></tbody></table></div>',
      "h",
    ],
    [
      "<section> — REGRESSION guard: already worked before the fix",
      '<section id="i"></section>',
      "i",
    ],
  ];

  for (const [name, html, expectedId] of cases) {
    it(`retains id on ${name}`, () => {
      expect(roundTrip(html)).toContain(`id="${expectedId}"`);
    });
  }

  // TRAP 1 (silent-failure): `withParagraphVariant.toDOM` rebuilds its output
  // spec FROM SCRATCH — it does not delegate to the withClassStyle-wrapped
  // toDOM it sits on top of. Any wrapper applied UNDER it is erased. This case
  // pins that `withId` is applied LAST, after the paragraph-variant wrap.
  it("TRAP: <p> keeps id ALONGSIDE the variant class and style (withId applied last)", () => {
    const out = roundTrip('<p class="desc" id="pp" style="color:var(--now)">t</p>');
    expect(out).toContain('id="pp"');
    expect(out).toContain('class="desc"');
    expect(out).toContain("color:var(--now)");
  });

  // TRAP 2 (silent-failure): `secNode.toDOM` returns the `{dom, contentDOM}`
  // DOMOutputSpec form, not an array — `mergeAttrsIntoOutputSpec` used to
  // return any non-array spec UNCHANGED, silently eating every merged attr.
  it("TRAP: <h2 class=sec> keeps id even though its toDOM returns {dom, contentDOM}", () => {
    const out = roundTrip('<h2 class="sec" id="s1"><span class="secnum">01</span>Summary</h2>');
    expect(out).toContain('id="s1"');
    expect(out).toContain('class="secnum"');
    expect(out).toContain("01");
  });

  it("keeps every id in the fixture through a full round-trip", () => {
    const body = fixtureBody();
    const before = idsIn(body);
    expect(before.length).toBeGreaterThan(10); // guard: the fixture still has ids
    expect(idsIn(roundTrip(body))).toEqual(before);
  });

  it("REGRESSION: the legacy fixture's <section> ids are untouched by the widened retention", () => {
    const body = splitShell(readFileSync(LEGACY_FIXTURE_PATH, "utf-8")).bodyHtml;
    expect(idsIn(roundTrip(body))).toEqual(idsIn(body));
  });
});

describe("link target/rel normalization (ADR-0062 Amendment 3)", () => {
  it("round-trips target=_blank and FORCES rel=noopener noreferrer when absent", () => {
    const out = roundTrip('<p><a href="https://example.com/" target="_blank">x</a></p>');
    expect(out).toContain('target="_blank"');
    expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(out).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  it("does not duplicate tokens when the author already wrote noopener noreferrer", () => {
    const out = roundTrip(
      '<p><a href="https://example.com/" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    const rel = /rel="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(rel.split(/\s+/).filter(Boolean).sort()).toEqual(["noopener", "noreferrer"]);
  });

  it("DROPS target=_top / _parent / a named frame — frame-escape primitives", () => {
    for (const target of ["_top", "_parent", "victimFrame"]) {
      const out = roundTrip(`<p><a href="https://example.com/" target="${target}">x</a></p>`);
      expect(out).not.toContain("target=");
      expect(out).toContain('href="https://example.com/"');
    }
  });

  it("STRIPS rel=opener — it undoes the tabnabbing mitigation", () => {
    const out = roundTrip('<p><a href="https://example.com/" rel="opener">x</a></p>');
    expect(out).not.toContain("opener");
  });

  it("keeps an allowlisted rel token like nofollow on a same-tab link", () => {
    const out = roundTrip('<p><a href="https://example.com/" rel="nofollow">x</a></p>');
    expect(out).toContain('rel="nofollow"');
  });

  it("drops an unrecognized rel token rather than passing it through", () => {
    const out = roundTrip('<p><a href="https://example.com/" rel="totally-made-up">x</a></p>');
    expect(out).not.toContain("totally-made-up");
  });

  it("keeps an in-page fragment href intact (the anchor half of the fix)", () => {
    expect(roundTrip('<p><a href="#summary">go</a></p>')).toContain('href="#summary"');
  });
});

describe("idempotency — the strongest guard against rel double-appending", () => {
  it("serialize(parse(serialize(parse(h)))) is byte-identical to serialize(parse(h))", () => {
    const once = roundTrip(fixtureBody());
    expect(roundTrip(once)).toBe(once);
  });

  it("is idempotent for a target=_blank link with no author rel", () => {
    const once = roundTrip('<p><a href="https://example.com/" target="_blank">x</a></p>');
    expect(roundTrip(once)).toBe(once);
  });
});

describe("SECURITY — the widened retention set is still an allowlist", () => {
  it("rejects a javascript: href WHOLLY, target and all", () => {
    const out = roundTrip('<p><a href="javascript:alert(1)" target="_blank">x</a></p>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("target=");
    expect(out).toContain("x"); // the text survives unmarked
  });

  // `id` is now a retained attribute, so its VALUE reaches a real DOM
  // attribute — the same class of hole `withSafeHref`/`sanitizeStyle` close
  // for href/style. The guarantee is that the value can never break OUT of
  // its quotes and become a new attribute. Asserted structurally (re-parse
  // the output and look for the injected attribute) rather than by string
  // matching: `onload=` legitimately appears INSIDE the escaped value, and a
  // naive `not.toContain("onload=")` would fail on correct output.
  //
  // This also pins linkedom as load-bearing for the escaping itself — this
  // package has swapped DOM backends once already (jsdom → linkedom,
  // ADR-0062 §3), and a backend that did not escape `"` in attribute values
  // would turn every retained id into an injection point.
  it("escapes an attribute-breaking id — it can never become a new attribute", () => {
    const hostileId = 'x" onload="alert(1)';
    const out = roundTrip(`<p id="x&quot; onload=&quot;alert(1)">t</p>`);
    expect(out).toContain("&quot;"); // the quote is escaped, not emitted raw
    const document = getDomEnvironmentDocument();
    const probe = document.createElement("div");
    probe.innerHTML = out;
    const paragraph = probe.querySelector("p");
    expect(paragraph?.getAttribute("onload")).toBeNull();
    expect(paragraph?.getAttribute("id")).toBe(hostileId);
  });

  it("Node.fromJSON: a non-string id is REJECTED by the attr validator, never rendered", () => {
    const doc = parseBody('<p id="ok">t</p>') as Record<string, unknown>;
    const content = doc.content as Array<Record<string, unknown>>;
    const para = content[0] as Record<string, unknown>;
    (para.attrs as Record<string, unknown>).id = { toString: () => 'x" onload="alert(1)' };
    expect(() => PMNode.fromJSON(reportSchema, doc)).toThrow();
  });

  it("Node.fromJSON: a hostile target/rel in the sidecar is normalized at toDOM", () => {
    const doc = parseBody('<p><a href="https://example.com/">x</a></p>') as Record<string, unknown>;
    const content = doc.content as Array<Record<string, unknown>>;
    const para = content[0] as Record<string, unknown>;
    const text = (para.content as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const marks = text.marks as Array<Record<string, unknown>>;
    const linkAttrs = marks[0]?.attrs as Record<string, unknown>;
    linkAttrs.target = "_top";
    linkAttrs.rel = "opener stylesheet";
    const out = serializeBody(doc);
    expect(out).not.toContain("_top");
    expect(out).not.toContain("opener");
    expect(out).not.toContain("stylesheet");
  });

  it("Node.fromJSON: target=_blank straight from the sidecar still gains noopener noreferrer", () => {
    const doc = parseBody('<p><a href="https://example.com/">x</a></p>') as Record<string, unknown>;
    const content = doc.content as Array<Record<string, unknown>>;
    const para = content[0] as Record<string, unknown>;
    const text = (para.content as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const marks = text.marks as Array<Record<string, unknown>>;
    (marks[0]?.attrs as Record<string, unknown>).target = "_blank";
    const out = serializeBody(doc);
    expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(out).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });
});

describe("duplicate id dedupe at serialize time (first wins)", () => {
  it("keeps the FIRST occurrence and drops the id from later duplicates", () => {
    const out = roundTrip('<p id="dup">one</p><p id="dup">two</p><p id="other">three</p>');
    expect(idsIn(out)).toEqual(["dup", "other"]);
    // Positional check: the surviving `dup` is on the paragraph holding "one".
    expect(out.indexOf('id="dup"')).toBeLessThan(out.indexOf("two"));
  });

  it("dedupes across DIFFERENT element types too", () => {
    const out = roundTrip('<h2 id="dup">h</h2><section id="dup"></section>');
    expect(idsIn(out)).toEqual(["dup"]);
  });
});
