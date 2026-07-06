import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { splitShell } from "./shell";

export const FIXTURE_PATH = resolve(
  process.cwd(),
  "../fixture/ai-readiness-report.html",
);

export function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf-8");
}

export function loadFixtureBody(): string {
  return splitShell(loadFixture()).body;
}

export interface NamedFragment {
  name: string;
  html: string;
}

/**
 * Pull seven representative fragments straight out of the real fixture body
 * (Test A). Each is the `outerHTML` of a real element in the report, found
 * via CSS selector against the live DOM — no hand-authored HTML.
 */
export function extractFragments(bodyHtml: string): NamedFragment[] {
  const dom = new JSDOM(`<body>${bodyHtml}</body>`);
  const doc = dom.window.document;

  const first = (selector: string): Element => {
    const el = doc.querySelector(selector);
    if (!el) throw new Error(`fixture fragment not found: ${selector}`);
    return el;
  };

  return [
    { name: "chip-cluster", html: first(".hero .chips").outerHTML },
    { name: "card", html: first(".hero-grid > .card").outerHTML },
    { name: "checklist", html: first("ul.checklist").outerHTML },
    { name: "details-summary", html: first("details.resgroup").outerHTML },
    { name: "table", html: first(".tablewrap").outerHTML },
    { name: "resrow", html: first(".resrow").outerHTML },
    { name: "sec-heading", html: first("h2.sec").outerHTML },
  ];
}
