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
  const body = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1];
  if (body === undefined) throw new Error("no :root block found in theme.css");
  return body;
}

const root = rootBlock(themeCss);

/** Read a custom-property value declared inside a CSS block body. */
function declValue(block: string, name: string): string | undefined {
  // Anchored so a token that is a prefix of another (--brand / --brand-hover)
  // or a suffix of a mapping (--brand / --color-brand) can never match it.
  return block.match(new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
}

// The color primitives that map through @theme inline to Tailwind utilities,
// with the exact ClickUp light values ADR-0086 §"Decision outcome" records.
// Keeping the NAMES stable is what makes the re-skin class-churn-free; pinning
// the VALUES means a wrong hex cannot ship green.
const REQUIRED_PRIMITIVES: Record<string, string> = {
  "--bg": "#f5f6f8",
  "--surface": "#ffffff",
  "--surface-raised": "#f2f1fd",
  "--border": "#e6e7eb",
  "--border-strong": "#d6d8de",
  "--fg": "#2a2e34",
  "--muted": "#656f7d",
  "--subtle": "#6b7684", // darkened for WCAG AA on the light ground (T1)
  "--brand": "#7b68ee",
  "--brand-hover": "#5f4fd6",
  "--on-brand": "#ffffff",
  "--success": "#2ecc71",
  "--warning": "#ffc800",
  "--danger": "#e8465e",
  // Additive ClickUp accents (ADR-0086): sky, pink, and the info semantic.
  "--accent": "#49ccf9",
  "--accent-2": "#fd71af",
  "--info": "#49ccf9",
};

describe("theme.css token contract (ADR-0086, ClickUp light)", () => {
  for (const [token, hex] of Object.entries(REQUIRED_PRIMITIVES)) {
    it(`declares ${token}: ${hex} on :root`, () => {
      expect(declValue(root, token)?.toLowerCase()).toBe(hex);
    });
  }

  // Additive redesign tokens (T1, PRD #330). Interactive-state tints, the
  // muted placeholder, and a soft-fill + dark-text-tier pair per semantic
  // colour so semantic text clears WCAG AA on the light ground. Values from
  // the App Shell Mockups report (Z0W60dI8hu, section 10).
  for (const [token, hex] of Object.entries({
    "--brand-soft": "#f2f1fd",
    "--hover": "#eef0f3",
    "--placeholder": "#8a94a3",
    "--success-soft": "#e6f8ee",
    "--success-fg": "#15803d",
    "--warning-soft": "#fff6d6",
    "--warning-fg": "#b45309",
    "--danger-soft": "#fdeaed",
    "--danger-fg": "#c62839",
    "--info-soft": "#e4f7fe",
    "--info-fg": "#0e7490",
  } as Record<string, string>)) {
    it(`declares ${token}: ${hex} on :root`, () => {
      expect(declValue(root, token)?.toLowerCase()).toBe(hex);
    });
  }

  it("declares a translucent brand focus-ring token on :root", () => {
    expect(declValue(root, "--brand-ring")).toMatch(/rgb\(|rgba\(/);
  });

  it("declares a motion-easing token on :root", () => {
    expect(declValue(root, "--ease")).toMatch(/cubic-bezier/);
  });

  it("declares color-scheme: light on :root (light is the default — ADR-0086)", () => {
    expect(declValue(root, "color-scheme")).toBe("light");
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

  // The additive tokens are only useful if they reach utilities / references.
  for (const mapping of [
    "--color-accent-2",
    "--color-info",
    "--gradient-brand",
    // additive redesign mappings (T1): interactive tints, placeholder, the
    // semantic soft/text-tier pairs, the focus ring, the xs shadow, easing.
    "--color-brand-soft",
    "--color-hover",
    "--color-placeholder",
    "--color-success-soft",
    "--color-success-fg",
    "--color-warning-soft",
    "--color-warning-fg",
    "--color-danger-soft",
    "--color-danger-fg",
    "--color-info-soft",
    "--color-info-fg",
    "--color-brand-ring",
    "--shadow-xs",
    "--ease-standard",
  ]) {
    it(`maps ${mapping} in the @theme inline block`, () => {
      expect(declValue(themeCss, mapping)).toBeTruthy();
    });
  }

  it("declares the violet → pink --brand-gradient on :root", () => {
    expect(declValue(root, "--brand-gradient")).toMatch(/linear-gradient/);
  });

  it("keeps the @custom-variant dark hook (dark is a deferred additive follow-up)", () => {
    expect(themeCss).toMatch(/@custom-variant\s+dark/);
  });

  it("ships no .dark {} palette values yet (dark deferred — ADR-0086)", () => {
    expect(themeCss).not.toMatch(/\.dark\s*\{/);
  });
});
