import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeEditability } from "./editability.js";
import { normalizeBody, probeFidelity } from "./fidelity-probe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, `./fixtures/${name}`), "utf-8");

/**
 * The normaliser is what makes the comparison mean something. Without it every
 * document would compare unequal for reasons that are not loss at all, and the
 * verdict would carry no information — the same failure mode ADR-0090 rejects
 * byte equality for. These four are the differences a round trip is ENTITLED
 * to make.
 */
describe("normalizeBody — the four differences a round trip is entitled to make", () => {
  it("collapses insignificant whitespace", () => {
    expect(normalizeBody("<p>one   two</p>")).toEqual(
      normalizeBody("<p>\n      one\n      two\n    </p>"),
    );
  });

  it("ignores attribute order", () => {
    expect(normalizeBody('<a href="/x" id="a" class="c">t</a>')).toEqual(
      normalizeBody('<a class="c" id="a" href="/x">t</a>'),
    );
  });

  it("ignores entity encoding", () => {
    expect(normalizeBody("<p>a &amp; b &lt; c</p>")).toEqual(normalizeBody("<p>a & b &lt; c</p>"));
  });

  it("ignores the self-closing form of a void element", () => {
    expect(normalizeBody("<p>a<br />b</p>")).toEqual(normalizeBody("<p>a<br>b</p>"));
  });

  it("does NOT ignore a missing element", () => {
    expect(normalizeBody("<p>a<em>b</em></p>")).not.toEqual(normalizeBody("<p>ab</p>"));
  });
});

describe("probeFidelity — would the editor KEEP these bytes (ADR-0090)", () => {
  it("answers an editor-origin version lossless WITHOUT parsing it", () => {
    // The deck is provably lossy when parsed (see below). Carrying a
    // `_source.json` sidecar must still answer `lossless`, because that body
    // was PRODUCED by the serialiser: the round trip is the identity by
    // construction (ADR-0062 §4). If this ever returns "lossy", the sidecar
    // branch has stopped short-circuiting and is parsing after all.
    const verdict = probeFidelity(fixture("interactive-deck.html"), true);
    expect(verdict).toEqual({ fidelity: "lossless", lostElements: [], lostAttributes: [] });
  });

  it("reads the generated report fixture as lossless", () => {
    expect(probeFidelity(fixture("ai-readiness-report.html"))).toEqual({
      fidelity: "lossless",
      lostElements: [],
      lostAttributes: [],
    });
  });

  it("reads the anchors-and-links fixture as lossless", () => {
    expect(probeFidelity(fixture("anchors-and-links.html"))).toEqual({
      fidelity: "lossless",
      lostElements: [],
      lostAttributes: [],
    });
  });

  it("reads the interactive deck as lossy, naming the script and the SVG", () => {
    const verdict = probeFidelity(fixture("interactive-deck.html"));
    expect(verdict?.fidelity).toBe("lossy");
    expect(verdict?.lostElements).toContain("script");
    expect(verdict?.lostElements).toContain("svg");
  });

  it("names the lost interaction attributes of the deck", () => {
    const verdict = probeFidelity(fixture("interactive-deck.html"));
    expect(verdict?.lostAttributes).toContain("hidden");
    expect(verdict?.lostAttributes).toContain("data-step");
  });

  it("deduplicates the lost items", () => {
    // The deck holds three <rect> and three <text> inside its diagram; a lost
    // items list is a list of NAMES, so each appears once however many were
    // dropped. A raw occurrence list would be unreadable in a confirm dialog.
    const verdict = probeFidelity(fixture("interactive-deck.html"));
    const rects = verdict?.lostElements.filter((n) => n === "rect") ?? [];
    expect(rects).toHaveLength(1);
    expect(new Set(verdict?.lostElements).size).toBe(verdict?.lostElements.length);
    expect(new Set(verdict?.lostAttributes).size).toBe(verdict?.lostAttributes.length);
  });

  it("sorts the lost items so the answer is stable", () => {
    const verdict = probeFidelity(fixture("interactive-deck.html"));
    expect(verdict?.lostElements).toEqual([...(verdict?.lostElements ?? [])].sort());
    expect(verdict?.lostAttributes).toEqual([...(verdict?.lostAttributes ?? [])].sort());
  });

  it("does not report an attribute that survives elsewhere in the document", () => {
    // The generated report round-trips with 45 `style` attributes in and 41
    // out: the schema normalises a few away per element. That is not the loss
    // this verdict is about, and counting occurrences would mark the ENTIRE
    // existing corpus lossy — leaving the field as uninformative as byte
    // equality would (ADR-0090, "the normaliser is a judgement call").
    const verdict = probeFidelity(fixture("ai-readiness-report.html"));
    expect(verdict?.lostAttributes).not.toContain("style");
  });

  it("does not report an element that survives elsewhere in the document", () => {
    // The element twin of the rule above, and the sharper half of it: the
    // round trip DELETES the first anchor outright (the schema does not retain
    // a `javascript:` href), yet the verdict is `lossless` because the second
    // anchor keeps the NAME `a` present. Measured, not assumed — the same
    // document with that anchor as its only `<a>` reports `lossy` with
    // lostElements `["a"]`.
    //
    // This is the accepted cost of measuring by name presence rather than
    // occurrence count (ADR-0090): counting would mark the entire existing
    // corpus lossy and leave the field as uninformative as byte equality. It
    // is pinned here so a future "fix" has to argue with the record rather
    // than silently reverse it. Fidelity is advisory, never authorization —
    // nothing gates on this verdict, so a false `lossless` costs a missing
    // warning, never a security decision.
    const html =
      '<html><body><p><a href="javascript:alert(1)">x</a></p><p><a href="/safe">y</a></p></body></html>';
    const verdict = probeFidelity(html);
    expect(verdict?.fidelity).toBe("lossless");
    expect(verdict?.lostElements).not.toContain("a");
  });

  it("reports a lost element even when its siblings survive", () => {
    const html = "<html><body><p>keep</p><script>alert(1)</script></body></html>";
    const verdict = probeFidelity(html);
    expect(verdict?.fidelity).toBe("lossy");
    expect(verdict?.lostElements).toEqual(["script"]);
  });

  it("answers UNKNOWN for bytes the shell split cannot handle", () => {
    // No usable <body> boundary: there is no round trip to run, so there is no
    // honest verdict to give. UNKNOWN is null, never a guess (ADR-0090 §4).
    // The input is pinned against the REAL predicate rather than assumed —
    // ADR-0062 Amendment 4 already moved this line once (body-less documents
    // became splittable), and migration 0022 had to reset the corpus for it.
    const unsplittable = "<html><body><p>a body that never closes</p></html>";
    expect(probeEditability(unsplittable)).toBe("unsplittable");
    expect(probeFidelity(unsplittable)).toBeNull();
  });

  it("still requires the shell to split even with a sidecar", () => {
    // Mirrors `probeEditability`'s own rule: an unclosed <body> is un-openable
    // whatever the sidecar says, so there is no round trip to answer for and
    // the short-circuit must not fire.
    expect(probeFidelity("<html><body><p>hi</p></html>", true)).toBeNull();
  });

  it("is total — it answers rather than throwing, whatever it is handed", () => {
    expect(() => probeFidelity("")).not.toThrow();
    expect(() => probeFidelity(`<html><body>${"<div>".repeat(6000)}`)).not.toThrow();
  });
});
