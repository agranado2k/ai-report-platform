// Class + sanitized-style retention across EVERY named block node (ticket
// #370, ADR-0062 §3). #368 (ticket #359) retained `class` on `<section>` only,
// through a node-by-node edit; `sec`, `card`, `checklist`, `grid`, the table
// family, `details`/`summary`, `resrow` and the `rt`/`rd`/`rtags`/`chips`/
// `block-label` inline-content containers still dropped `class`, and every one
// of them — `<section>` included — still dropped `style`. ADR-0062's own
// decision driver ("any class or attribute silently dropped by the editor is a
// product regression") makes that a bug, and the glossary's `Retained
// attribute set` already promises `class`/`style` (style sanitized) on ANY
// node. This suite pins the widened retention, now delivered by a single
// schema-wide sweep (schema.ts) shaped like the `id` sweep, so a block node
// added later inherits it instead of quietly reintroducing the drop.

import type { NodeSpec } from "prosemirror-model";
import { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";
import { getDomEnvironmentDocument } from "./dom-environment.js";
import { reportSchema } from "./schema.js";

/** The editor's own parse→serialize path — exactly what an edit-save does. */
const roundTrip = (bodyHtml: string): string => serializeBody(parseBody(bodyHtml));

// One case per DISTINCT `toDOM` shape the sweep now covers — each row is a
// different code path through `withClassStyle`, not just a different tag. Every
// fragment carries a MULTI-token class (to prove verbatim retention, not a
// reduction to a boolean/enum) and an inert `style` (to prove sanitized style
// survives). `probe` is the element whose attributes we assert on.
const cases: ReadonlyArray<{
  readonly name: string;
  readonly html: string;
  readonly probe: string;
  readonly expectClass: string;
}> = [
  {
    name: "card — dedicated block node that already retained class, now also style",
    html: '<div class="card pillar" style="color:var(--now)"><p>t</p></div>',
    probe: "div.card",
    expectClass: "card pillar",
  },
  {
    name: "grid — class+cols node, now also style",
    html: '<div class="grid g2" style="gap:8px"><div class="card"><p>t</p></div></div>',
    probe: "div.grid",
    expectClass: "grid g2",
  },
  {
    name: "checklist — toDOM hard-coded class:'checklist', now verbatim + style",
    html: '<ul class="checklist tight" style="margin:0"><li>a</li></ul>',
    probe: "ul.checklist",
    expectClass: "checklist tight",
  },
  {
    name: "checklist_item — <li> that dropped both before",
    html: '<ul class="checklist"><li class="done" style="opacity:.5">a</li></ul>',
    probe: "li.done",
    expectClass: "done",
  },
  {
    name: "tablewrap — dropped style before",
    html: '<div class="tablewrap wide" style="overflow:auto"><table><tbody><tr><td>c</td></tr></tbody></table></div>',
    probe: "div.tablewrap",
    expectClass: "tablewrap wide",
  },
  {
    name: "table — class node that dropped style before",
    html: '<div class="tablewrap"><table class="grid-table" style="width:100%"><tbody><tr><td>c</td></tr></tbody></table></div>',
    probe: "table.grid-table",
    expectClass: "grid-table",
  },
  {
    name: "table_head (thead) — dropped both before",
    html: '<div class="tablewrap"><table><thead class="th-head" style="background:#eee"><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table></div>',
    probe: "thead.th-head",
    expectClass: "th-head",
  },
  {
    name: "table_body (tbody) — dropped both before",
    html: '<div class="tablewrap"><table><tbody class="tb" style="color:#111"><tr><td>c</td></tr></tbody></table></div>',
    probe: "tbody.tb",
    expectClass: "tb",
  },
  {
    name: "table_row (tr) — dropped both before",
    html: '<div class="tablewrap"><table><tbody><tr class="hr" style="height:2rem"><td>c</td></tr></tbody></table></div>',
    probe: "tr.hr",
    expectClass: "hr",
  },
  {
    name: "table_header (th) — retained style before, now class too",
    html: '<div class="tablewrap"><table><thead><tr><th class="num" style="width:22%">H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table></div>',
    probe: "th.num",
    expectClass: "num",
  },
  {
    name: "table_cell (td) — retained style before, now class too",
    html: '<div class="tablewrap"><table><tbody><tr><td class="cell" style="color:var(--now)">c</td></tr></tbody></table></div>',
    probe: "td.cell",
    expectClass: "cell",
  },
  {
    name: "details — class+open node that dropped style before",
    html: '<details class="resgroup card" style="margin:0" open><summary>S</summary><p>b</p></details>',
    probe: "details.resgroup",
    expectClass: "resgroup card",
  },
  {
    name: "summary — dropped both before",
    html: '<details><summary class="head" style="font-weight:700">S</summary><p>b</p></details>',
    probe: "summary.head",
    expectClass: "head",
  },
  {
    name: "resrow — class node that dropped style before",
    html: '<div class="resrow special" style="gap:4px"><p>t</p></div>',
    probe: "div.resrow",
    expectClass: "resrow special",
  },
  {
    name: "rt — inline-content container, class reduced to 'rt' before",
    html: '<div class="rt hot" style="color:red">t</div>',
    probe: "div.rt",
    expectClass: "rt hot",
  },
  {
    name: "rd — inline-content container",
    html: '<div class="rd em" style="color:red">t</div>',
    probe: "div.rd",
    expectClass: "rd em",
  },
  {
    name: "rtags — inline-content container",
    html: '<div class="rtags row" style="gap:4px"><span class="chip chip-cto">C</span></div>',
    probe: "div.rtags",
    expectClass: "rtags row",
  },
  {
    name: "chips — inline-content container",
    html: '<div class="chips row" style="gap:4px"><span class="chip chip-cto">C</span></div>',
    probe: "div.chips",
    expectClass: "chips row",
  },
  {
    name: "block-label — inline-content container",
    html: '<div class="block-label big" style="color:red">Read</div>',
    probe: "div.block-label",
    expectClass: "block-label big",
  },
  {
    name: "sec — non-array {dom,contentDOM} toDOM, dropped both before",
    html: '<h2 class="sec big" style="color:teal"><span class="secnum">01</span>Title</h2>',
    probe: "h2.sec",
    expectClass: "sec big",
  },
  {
    name: "section — REGRESSION: class already worked (#368), style is the new half",
    html: '<section class="slide" style="padding:2rem"><p>t</p></section>',
    probe: "section",
    expectClass: "slide",
  },
  {
    name: "htmlBlock (aside) — REGRESSION: catch-all already retained both",
    html: '<aside class="note" style="color:#333"><p>t</p></aside>',
    probe: "aside.note",
    expectClass: "note",
  },
  {
    name: "heading — REGRESSION: schema-basic node already retained both",
    html: '<h3 class="sub" style="color:var(--now)">H</h3>',
    probe: "h3.sub",
    expectClass: "sub",
  },
];

describe("class + sanitized style retention on every named block node (#370)", () => {
  for (const { name, html, probe, expectClass } of cases) {
    it(`retains class (verbatim) + style (sanitized) on ${name}`, () => {
      const out = roundTrip(html);
      const document = getDomEnvironmentDocument();
      const container = document.createElement("div");
      container.innerHTML = out;
      const element = container.querySelector(probe);
      expect(element, `expected to find ${probe} in ${out}`).not.toBeNull();
      expect(element?.getAttribute("class")).toBe(expectClass);
      // The inert style declaration survives the round trip.
      expect(element?.getAttribute("style") ?? "").not.toBe("");
    });
  }
});

describe("style is SANITIZED, not passed through, wherever it is now retained (#370)", () => {
  it("drops a url(...) declaration on a card while keeping its inert sibling", () => {
    const out = roundTrip(
      '<div class="card" style="background:url(https://attacker.example/leak); color:var(--now)"><p>t</p></div>',
    );
    expect(out).not.toContain("url(");
    expect(out).not.toContain("attacker.example");
    expect(out).toContain("color:var(--now)");
  });

  it("strips an @import smuggled into a section style", () => {
    const out = roundTrip('<section style="@import url(evil.css); color:red"><p>t</p></section>');
    expect(out).not.toContain("@import");
    expect(out).not.toContain("evil.css");
    expect(out).toContain("color:red");
  });

  it("strips a legacy expression(...) on a table cell", () => {
    const out = roundTrip(
      '<div class="tablewrap"><table><tbody><tr><td style="width:expression(alert(1)); color:red">c</td></tr></tbody></table></div>',
    );
    expect(out).not.toContain("expression(");
    expect(out).toContain("color:red");
  });
});

describe("Node.fromJSON refuses a non-string class/style in the _source.json sidecar (#370)", () => {
  // `diffRendered`/`diffDocs` build docs via `Node.fromJSON` from the
  // CLIENT-SUPPLIED `_source.json` sidecar, which NEVER runs `getAttrs` (the PR
  // #156 lesson). Without `validate: "string|null"` on the swept attrs, a
  // sidecar could hand a non-string straight to `toDOM` and into a real DOM
  // attribute. The validator rejects the whole doc instead.
  const withTamperedAttr = (attr: "class" | "style"): (() => PMNode) => {
    // A `card` is a swept node that gained its guard from the sweep (it had no
    // validator of its own before #370), so it is the honest node to prove it on.
    const doc = parseBody('<div class="card">t</div>') as Record<string, unknown>;
    const content = doc.content as Array<Record<string, unknown>>;
    const card = content[0] as Record<string, unknown>;
    (card.attrs as Record<string, unknown>)[attr] = { toString: () => 'x" onload="alert(1)' };
    return () => PMNode.fromJSON(reportSchema, doc);
  };

  it("rejects a non-string class", () => {
    expect(withTamperedAttr("class")).toThrow();
  });

  it("rejects a non-string style", () => {
    expect(withTamperedAttr("style")).toThrow();
  });
});

describe("the sweep is schema-wide, so a block node added later inherits it (#370)", () => {
  it("every named block node with a toDOM declares class+style with the string|null validator", () => {
    const offenders: string[] = [];
    reportSchema.spec.nodes.forEach((name: string, spec: NodeSpec) => {
      // Match the sweep's own predicate: nodes with a toDOM, block-only
      // (inline nodes like image/hard_break are out of the "block node" set).
      if (!spec.toDOM) return;
      if (spec.group === "inline" || spec.inline) return;
      const classSpec = spec.attrs?.class as { validate?: unknown } | undefined;
      const styleSpec = spec.attrs?.style as { validate?: unknown } | undefined;
      if (classSpec?.validate !== "string|null" || styleSpec?.validate !== "string|null") {
        offenders.push(name);
      }
    });
    expect(offenders, `these block nodes escaped the class/style sweep: ${offenders}`).toEqual([]);
  });
});

describe("the sweep never touches marks (#370)", () => {
  // Marks split and merge by attribute EQUALITY, so an `id`/`class` carried on a
  // mark would be copied onto every run the mark splits into — one attribute
  // silently becoming N. The chip/pill/kbd marks reconstruct their class from a
  // variant instead; they must carry no raw class/style/id.
  for (const name of ["chip", "pill", "kbd"]) {
    it(`reconstructed mark '${name}' carries no raw class/style/id`, () => {
      const spec = reportSchema.spec.marks.get(name);
      expect(spec?.attrs?.class).toBeUndefined();
      expect(spec?.attrs?.style).toBeUndefined();
      expect(spec?.attrs?.id).toBeUndefined();
    });
  }

  it("no mark carries an id attr (id would multiply across split runs)", () => {
    const offenders: string[] = [];
    reportSchema.spec.marks.forEach((name: string, spec: { attrs?: Record<string, unknown> }) => {
      if (spec.attrs?.id !== undefined) offenders.push(name);
    });
    expect(offenders).toEqual([]);
  });
});
