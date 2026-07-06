import { describe, it } from "vitest";
import { JSDOM } from "jsdom";
import { loadFixtureBody, extractFragments } from "../src/lib/fixtures";
import { roundtripHtml } from "../src/lib/roundtrip";
import { l0Plugins } from "../src/editors/l0";
import { l1Plugins } from "../src/editors/l1";
import { l2Plugins } from "../src/editors/l2";

function analyze(html: string) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const body = dom.window.document.body;
  const text = (body.textContent ?? "").replace(/\s+/g, " ").trim();
  const classes = new Set<string>();
  const tags: Record<string, number> = {};
  body.querySelectorAll("*").forEach((el) => {
    tags[el.tagName.toLowerCase()] = (tags[el.tagName.toLowerCase()] ?? 0) + 1;
    el.classList.forEach((c) => {
      if (!c.startsWith("slate-")) classes.add(c);
    });
  });
  return { text, classes, tags };
}

function diffReport(name: string, input: string, output: string) {
  const a = analyze(input);
  const b = analyze(output);
  const lostClasses = [...a.classes].filter((c) => !b.classes.has(c));
  const textMatch = a.text === b.text;
  const tagsLostOrChanged: string[] = [];
  for (const [tag, count] of Object.entries(a.tags)) {
    if ((b.tags[tag] ?? 0) < count) tagsLostOrChanged.push(`${tag}: ${count}->${b.tags[tag] ?? 0}`);
  }
  console.log(
    `  [${name}] textMatch=${textMatch} lostClasses=${JSON.stringify(lostClasses)} tagDelta=${JSON.stringify(tagsLostOrChanged)} outputTextLen=${b.text.length}/${a.text.length}`,
  );
}

describe("Test A — fidelity scorecard (structured diff)", () => {
  const fragments = extractFragments(loadFixtureBody());

  for (const fragment of fragments) {
    it(`fragment: ${fragment.name}`, async () => {
      console.log(`\n==== ${fragment.name} ====`);
      const inputAnalysis = analyze(fragment.html);
      console.log(
        `  input: text="${inputAnalysis.text.slice(0, 80)}..." classes=${JSON.stringify([...inputAnalysis.classes])} tags=${JSON.stringify(inputAnalysis.tags)}`,
      );

      const l0 = await roundtripHtml(fragment.html, l0Plugins());
      diffReport("L0", fragment.html, l0.output);

      const l1 = await roundtripHtml(fragment.html, l1Plugins());
      diffReport("L1", fragment.html, l1.output);

      const l2 = await roundtripHtml(fragment.html, l2Plugins());
      diffReport("L2", fragment.html, l2.output);
    });
  }
});
