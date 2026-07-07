import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reinjectShell, splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "./fixtures/ai-readiness-report.html");
const loadFixtureHtml = () => readFileSync(FIXTURE_PATH, "utf-8");

describe("splitShell / reinjectShell", () => {
  it("round-trips the real fixture byte-identically when the body is unchanged", () => {
    const original = loadFixtureHtml();
    const { shell, bodyHtml } = splitShell(original);

    expect(bodyHtml).toContain('class="shell"');
    expect(bodyHtml).toContain("Executive summary");
    expect(shell.pre).toContain("<style>");
    expect(shell.pre).not.toContain("Executive summary");

    const reconstituted = reinjectShell(shell, bodyHtml);
    expect(reconstituted).toBe(original);
    expect(reconstituted.length).toBe(original.length);
  });

  it("re-injecting a modified body only changes the body region", () => {
    const original = loadFixtureHtml();
    const { shell, bodyHtml } = splitShell(original);
    const modifiedBody = bodyHtml.replace("Executive summary", "Executive Summary EDITED");

    const result = reinjectShell(shell, modifiedBody);

    expect(result).not.toBe(original);
    expect(result).toContain("Executive Summary EDITED");
    expect(result.startsWith(shell.pre)).toBe(true);
    expect(result.endsWith(shell.post)).toBe(true);
  });

  it("throws when no <body> opening tag is present", () => {
    expect(() => splitShell("<html><head></head></html>")).toThrow(/<body>/);
  });

  it("throws when no </body> closing tag is present", () => {
    expect(() => splitShell("<html><body>unterminated")).toThrow(/<\/body>/);
  });
});
