import { describe, expect, it } from "vitest";
import { roundtripHtml } from "../src/lib/roundtrip";
import { l1Plugins } from "../src/editors/l1";

describe("L1 sanity", () => {
  it("round-trips a chip span via generic passthrough", async () => {
    const { output, value } = await roundtripHtml(
      '<div class="chips"><span class="chip chip-cto">CTO</span></div>',
      l1Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
  });

  it("round-trips a details/summary", async () => {
    const { output, value } = await roundtripHtml(
      '<details class="resgroup card" open><summary>Books</summary><div class="resrow">row</div></details>',
      l1Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
  });
});
