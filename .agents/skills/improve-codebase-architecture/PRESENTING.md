# Presenting the candidates

The architectural review is **one self-contained file, written outside the repo
tree**. That is the whole obligation, and it has two halves: self-contained,
because the review has to survive being sent to somebody who cannot run your
build; and outside the tree, because a repo that accumulates dated architecture
reviews has grown a second, staler glossary that nobody deletes.

The rendering is yours. Pick the richest one your project can actually view:

- **A single HTML file** when someone will open it in a browser — the diagrams
  carry the argument, and a picture of a shallow module beside a deep one lands
  in a way a bullet list does not. The worked scaffold below is that rendering,
  and its diagrams are **inline SVG** — hand-authored vector boxes, bands and
  arrows, never ASCII art (code craft §10, `constitution/shared-code-craft.md`).
- **A markdown file** when the review will be read in a terminal, pasted into a
  ticket, or folded into a decision record. The same cards, the same order,
  diagrams as fenced diagram-language blocks (mermaid, in this kit) that the forge renders — never
  ASCII drawings. If the argument leans on its diagrams, prefer the HTML
  rendering, where they can be real drawings.

What does not change with the rendering: the cards, their fields, the
before/after comparison, and the vocabulary discipline at the bottom of this
file.

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam,
red arrow = leakage, thick dark box = deep module. No introduction paragraph —
straight into the candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the glossary
terms ([LANGUAGE.md](./LANGUAGE.md)) without ceremony.

Each candidate is one card:

- **Title** — short, names the deepening (e.g. "Collapse the Order intake pipeline"). Domain nouns come from `docs/domain-glossary.md`.
- **Badge row** — recommendation strength (`Strong`, `Worth exploring`, `Speculative`), plus a tag for the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock` — see [DEEPENING.md](./DEEPENING.md)).
- **Files** — monospaced list.
- **Before / After diagram** — the centrepiece. Two columns, side by side. See patterns below.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤6 words each. e.g. "Tests hit one interface", "Pricing logic stops leaking", "Delete 4 shallow wrappers".
- **Decision-record callout** (if applicable) — one line, in a warning-tinted box, citing the record by its own id.

No paragraphs of explanation. If the diagram needs a paragraph to be understood,
redraw the diagram.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Don't make every diagram look
the same — variety is part of the point.

Whatever the pattern, in the HTML rendering every diagram is an inline `<svg>`
element: SVG scales, diffs as text, inherits the page's fonts, and needs no
network or runtime to render. Never ASCII art, and no rasterized screenshots.

### Node-and-edge graph (the workhorse for dependencies / call flow)

Use a graph when the point is "X calls Y calls Z, and look at the mess." Colour
the leaking edges red and the deep module dark. A sequence diagram works well
for "before: 6 round-trips; after: 1."

### Hand-built boxes-and-arrows (when the layout engine fights you)

Modules as boxes with borders and labels; arrows drawn by hand. Reach for this
when you want the "after" diagram to feel like one thick-bordered deep module
with greyed-out internals — a general-purpose graph renderer will not give that
the right weight.

### Cross-section (good for layered shallowness)

Stack horizontal bands to show the layers a call passes through. Before: six
thin layers each doing nothing. After: one thick band labelled with the
consolidated responsibility.

### Mass diagram (good for "interface as wide as implementation")

Two rectangles per module — one for interface surface area, one for
implementation. Before: the interface rectangle is nearly as tall as the
implementation rectangle (shallow). After: the interface rectangle is short, the
implementation rectangle is tall (deep).

### Call-graph collapse

Before: a tree of calls as nested boxes. After: the same tree collapsed into one
box, with the now-internal calls faded inside it.

## Style guidance

- Lean editorial, not corporate-dashboard. Generous whitespace.
- Colour sparingly: one accent, plus red for leakage and amber for warnings.
- Keep diagrams small enough that before/after sits side by side without scrolling.
- Module labels inside diagrams read as schematic, not as UI: small, uppercase, tracked.

## Top recommendation section

One larger card. Candidate name, one sentence on why, a link to its card. That's
it.

## Tone

Plain English, concise — but the architectural nouns and verbs come straight from
[LANGUAGE.md](./LANGUAGE.md). Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) · boundary (for seam) · layer, wrapper (for module, when you mean module).

**Phrasings that fit the style:**

- "Order intake module is shallow — interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: the real transport in production, in-memory in tests."

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in
one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks;
implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or
*"cleaner code"* — those terms aren't in the glossary and don't earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could
be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't
in [LANGUAGE.md](./LANGUAGE.md), reach for one that is before inventing a new
one.

---

## Worked example: a single HTML file

One rendering, not the rule — but a fully self-contained one: every style is
inline and every diagram is a hand-authored inline `<svg>`, so the file renders
identically from a laptop, a ticket attachment, or an airgapped machine. No
CDN, no diagram library, no network at *view* time — the "self-contained" half
of the obligation at the top of this file, taken literally.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — the repo's name</title>
    <style>
      /* one inline stylesheet: page layout, the card grid, and the few
         diagram classes the SVGs share */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; marker-end: url(#arrow-leak); }
      .deep { fill: #0f172a; }
      .module { fill: #fff; stroke: #334155; }
      .label { font: 600 10px/1 monospace; letter-spacing: 0.08em; }
    </style>
  </head>
  <body>
    <main>
      <header>…</header>
      <section id="candidates">
        <!-- per card, the before/after pair: two inline SVGs side by side -->
        <figure>
          <svg viewBox="0 0 320 200" role="img" aria-label="Before: six shallow modules, pricing leaking across the seam">
            <rect class="module" x="…" y="…" width="…" height="…" />
            <line class="seam" x1="…" y1="…" x2="…" y2="…" />
            <line class="leak" x1="…" y1="…" x2="…" y2="…" />
            <text class="label" x="…" y="…">ORDER INTAKE</text>
          </svg>
          <svg viewBox="0 0 320 200" role="img" aria-label="After: one deep module">…</svg>
        </figure>
      </section>
      <section id="top-recommendation">…</section>
    </main>
  </body>
</html>
```

Give every `<svg>` a `viewBox` (so the pair scales to sit side by side), a
`role="img"`, and an `aria-label` that states the diagram's one-sentence claim —
the label doubles as the check that the diagram *has* one claim.

Write it to `<tmpdir>/architecture-review-<timestamp>.html`, resolving the temp
directory from `$TMPDIR` and falling back to `/tmp` (or `%TEMP%` on Windows).
Open it with the platform's own opener — `xdg-open` on Linux, `open` on macOS,
`start` on Windows — and give the absolute path either way, because the opener is
the part most likely to fail silently.

The page carries no scripts at all: the diagrams are static SVG and the styles
are inline, so nothing has to load, initialise, or be reachable. A review that
needs a runtime is not a review, it's a tool, and a tool belongs in the repo
where it can be tested.
