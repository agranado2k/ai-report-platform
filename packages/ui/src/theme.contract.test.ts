// Token-contract test for the shared arp-ui design tokens (ADR-0071's token
// home, consumed by BOTH apps/app and apps/view). ADR-0086 re-skins this file
// from the warm-dark "Forge & Ember" palette to the ClickUp LIGHT palette while
// keeping every token NAME identical, so the re-skin is zero component-class
// churn. This test pins that contract: the required names still exist on :root,
// the palette is the light one (`color-scheme: light`, brand violet #7B68EE),
// and the radii + font tokens survive the re-theme.
//
// Pure file-parsing test — no DOM, no build. Reads theme.css via node:fs, the
// same shape as scripts/test/agents-mapping.test.mjs pins a config file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Strip /* … */ comments so structural assertions never trip on prose that
// mentions a selector or token (e.g. a comment describing the deferred `.dark`
// block is not a shipped `.dark {}` rule).
const themeCss = readFileSync(
  fileURLToPath(new URL("./theme.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Extract the body of the first `:root { … }` block (primitives live here). */
function rootBlock(css: string): string {
  const match = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!match) throw new Error("no :root block found in theme.css");
  return match[1];
}

const root = rootBlock(themeCss);

/** Read a custom-property value declared inside a CSS block body. */
function declValue(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match?.[1].trim();
}

// The color primitives that map through @theme inline to Tailwind utilities.
// Keeping these NAMES stable is what makes the re-skin class-churn-free.
const REQUIRED_PRIMITIVES = [
  "--bg",
  "--surface",
  "--surface-raised",
  "--border",
  "--border-strong",
  "--fg",
  "--muted",
  "--subtle",
  "--brand",
  "--brand-hover",
  "--on-brand",
  "--success",
  "--warning",
  "--danger",
];

describe("theme.css token contract (ADR-0086, ClickUp light)", () => {
  for (const token of REQUIRED_PRIMITIVES) {
    it(`declares ${token} on :root`, () => {
      expect(declValue(root, token)).toBeTruthy();
    });
  }

  it("declares color-scheme: light on :root (light is the default — ADR-0086)", () => {
    expect(declValue(root, "color-scheme")).toBe("light");
  });

  it("uses the ClickUp brand violet #7B68EE for --brand", () => {
    expect(declValue(root, "--brand")?.toLowerCase()).toBe("#7b68ee");
  });

  // Radii + fonts are mapped in the @theme inline block; assert they survive the
  // re-theme anywhere in the file.
  for (const token of [
    "--radius-control",
    "--radius-card",
    "--font-sans",
    "--font-serif",
    "--font-mono",
  ]) {
    it(`still declares ${token}`, () => {
      expect(declValue(themeCss, token)).toBeTruthy();
    });
  }

  it("keeps the @custom-variant dark hook (dark is a deferred additive follow-up)", () => {
    expect(themeCss).toMatch(/@custom-variant\s+dark/);
  });

  it("ships no .dark {} palette values yet (dark deferred — ADR-0086)", () => {
    expect(themeCss).not.toMatch(/\.dark\s*\{/);
  });
});
