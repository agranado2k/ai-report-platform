import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { loadFixture } from "../src/lib/fixtures";
import { splitShell, reinject } from "../src/lib/shell";
import { roundtripHtml } from "../src/lib/roundtrip";
import { l1Plugins } from "../src/editors/l1";

function classInventory(html: string): Record<string, number> {
  const dom = new JSDOM(`<body>${html}</body>`);
  const counts: Record<string, number> = {};
  dom.window.document.body.querySelectorAll("*").forEach((el) => {
    el.classList.forEach((c) => {
      if (c.startsWith("slate-")) return;
      counts[c] = (counts[c] ?? 0) + 1;
    });
  });
  return counts;
}

describe("Test B — presentation-shell round trip (whole document, L1)", () => {
  it("imports the FULL real body through L1, exports, reinjects into the original shell", async () => {
    const fullHtml = loadFixture();
    const { shell, body } = splitShell(fullHtml);

    const { output } = await roundtripHtml(body, l1Plugins());

    const reassembled = reinject(shell, output);

    const outDir = resolve(process.cwd(), "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "roundtrip.html"), reassembled, "utf-8");

    // Class inventory diff: before vs after
    const before = classInventory(body);
    const after = classInventory(output);

    const allClasses = new Set([...Object.keys(before), ...Object.keys(after)]);
    const rows: { cls: string; before: number; after: number }[] = [];
    for (const cls of allClasses) {
      rows.push({ cls, before: before[cls] ?? 0, after: after[cls] ?? 0 });
    }
    rows.sort((a, b) => a.cls.localeCompare(b.cls));

    console.log("\n=== CLASS INVENTORY: before -> after (L1, full document) ===");
    for (const r of rows) {
      const marker = r.before !== r.after ? "  <-- DIFF" : "";
      console.log(`  ${r.cls.padEnd(20)} ${String(r.before).padStart(4)} -> ${String(r.after).padStart(4)}${marker}`);
    }

    const lost = rows.filter((r) => r.after < r.before);
    console.log("\n=== LOST OR REDUCED CLASSES ===");
    console.log(JSON.stringify(lost, null, 2));

    expect(reassembled).toContain("<style>");
    expect(reassembled).toContain(":root");
  });
});
