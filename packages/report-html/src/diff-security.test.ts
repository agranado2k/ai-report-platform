// SECURITY (PR #156 review, Fix 1): diffRendered/diffDocs (diff.ts) accept
// doc JSON via `Node.fromJSON` — and that JSON is CLIENT-SUPPLIED (the
// editor's save action, apps/app/app/routes/reports.$slug.edit.tsx, stores
// the request's `_source.json` sidecar verbatim). security.test.ts's hostile-
// fragment battery only covers the HTML→doc direction (parseBody's
// `getAttrs`, which runs sanitizeStyle/withSafeHref/the tag whitelist at
// PARSE time). `Node.fromJSON` never calls `parseDOM`/`getAttrs` — it goes
// straight through `computeAttrs`/`checkAttrs` — so every one of those
// parse-time sanitizers is a no-op on this path. This file mirrors
// security.test.ts's battery for the JSON→doc direction, asserting nothing
// dangerous survives into diffRendered's serialized HTML string.
import { describe, expect, it } from "vitest";
import type { PMDocJson } from "./body.js";
import { diffDocs, diffRendered } from "./diff.js";

const OLD_DOC: PMDocJson = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }],
};

function docWith(node: PMDocJson): PMDocJson {
  return { type: "doc", content: [node] };
}

/** Assert neither diffRendered's HTML output nor diffDocs (which must not
 *  even throw) leak a live script/iframe/object tag, an on* handler, a
 *  javascript: URL, or a url(...) style declaration. */
function assertHostileDocIsInert(newDoc: PMDocJson) {
  expect(() => diffDocs(OLD_DOC, newDoc)).not.toThrow();

  const html = diffRendered(OLD_DOC, newDoc);
  for (const tag of ["script", "iframe", "object"]) {
    expect(html.toLowerCase(), `rendered output must not contain <${tag}`).not.toContain(`<${tag}`);
  }
  expect(html.toLowerCase(), "rendered output must not carry an on* handler").not.toMatch(
    /\son[a-z]+\s*=/,
  );
  expect(html.toLowerCase(), "rendered output must not contain a javascript: URL").not.toContain(
    "javascript:",
  );
  expect(
    html.toLowerCase(),
    "rendered output must not contain a url(...) style function",
  ).not.toContain("url(");
}

describe("SECURITY (Fix 1): hostile doc JSON never survives diffRendered/diffDocs", () => {
  it("neutralizes a htmlBlock smuggling attrs.tag = 'script'", () => {
    assertHostileDocIsInert(docWith({ type: "htmlBlock", attrs: { tag: "script" }, content: [] }));
  });

  it("neutralizes a htmlBlock smuggling attrs.tag = 'iframe'", () => {
    assertHostileDocIsInert(docWith({ type: "htmlBlock", attrs: { tag: "iframe" }, content: [] }));
  });

  it("neutralizes a htmlBlock smuggling attrs.tag = 'object'", () => {
    assertHostileDocIsInert(docWith({ type: "htmlBlock", attrs: { tag: "object" }, content: [] }));
  });

  it("drops an onclick-style key smuggled into node attrs (expected already-inert: not in the attrs spec)", () => {
    assertHostileDocIsInert(
      docWith({ type: "htmlBlock", attrs: { tag: "div", onclick: "alert(1)" }, content: [] }),
    );
  });

  it("neutralizes a link mark smuggling a javascript: href", () => {
    assertHostileDocIsInert(
      docWith({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click me",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)", title: null } }],
          },
        ],
      }),
    );
  });

  it("strips a background:url(...) declaration smuggled into a htmlBlock's style attr", () => {
    assertHostileDocIsInert(
      docWith({
        type: "htmlBlock",
        attrs: { tag: "div", style: "background:url(https://attacker.example/leak)" },
        content: [],
      }),
    );
  });

  it("strips a url(...) declaration smuggled into a table cell's style attr", () => {
    assertHostileDocIsInert(
      docWith({
        type: "tablewrap",
        content: [
          {
            type: "table",
            content: [
              {
                type: "table_body",
                content: [
                  {
                    type: "table_row",
                    content: [
                      {
                        type: "table_cell",
                        attrs: { style: "background:url(https://attacker.example/leak)" },
                        content: [{ type: "text", text: "c" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
  });

  it("strips a url(...) declaration smuggled into a paragraph's style attr", () => {
    assertHostileDocIsInert(
      docWith({
        type: "paragraph",
        attrs: { style: "background:url(https://attacker.example/leak)" },
        content: [{ type: "text", text: "t" }],
      }),
    );
  });

  it("combined: every hostile payload smuggled onto one htmlBlock at once", () => {
    assertHostileDocIsInert(
      docWith({
        type: "htmlBlock",
        attrs: {
          tag: "script",
          onclick: "alert(1)",
          style: "background:url(https://attacker.example/leak)",
        },
        content: [],
      }),
    );
  });
});
