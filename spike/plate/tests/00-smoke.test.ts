import { describe, expect, it } from "vitest";
import { loadFixture, loadFixtureBody, extractFragments } from "../src/lib/fixtures";
import { splitShell, reinject } from "../src/lib/shell";

describe("smoke", () => {
  it("loads the real fixture", () => {
    const html = loadFixture();
    expect(html.length).toBeGreaterThan(10000);
    expect(html).toContain("AI-Age Readiness");
  });

  it("splits shell vs body and can reinject", () => {
    const html = loadFixture();
    const { shell, body } = splitShell(html);
    expect(shell.head).toContain("<style>");
    expect(shell.head).toContain(":root");
    expect(body).toContain('class="shell"');
    expect(body).not.toContain("<style>");
    const reassembled = reinject(shell, body);
    expect(reassembled).toContain("<style>");
    expect(reassembled).toContain('class="shell"');
  });

  it("extracts 7 named fragments from the real body", () => {
    const body = loadFixtureBody();
    const fragments = extractFragments(body);
    expect(fragments).toHaveLength(7);
    for (const f of fragments) {
      expect(f.html.length).toBeGreaterThan(0);
    }
    console.log(fragments.map((f) => `${f.name}: ${f.html.length} chars`).join("\n"));
  });
});
