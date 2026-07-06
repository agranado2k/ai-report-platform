import { describe, expect, it } from "vitest";
import { roundtripHtml } from "../src/lib/roundtrip";
import { l2Plugins } from "../src/editors/l2";

describe("L2 sanity", () => {
  it("round-trips a chip cluster with variant-aware chip element", async () => {
    const { output, value } = await roundtripHtml(
      '<div class="chips"><span class="chip chip-cto">CTO</span><span class="chip chip-staff">Staff Engineer</span></div>',
      l2Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
    expect(output).toContain("chip-cto");
    expect(output).toContain("chip-staff");
    expect(output).toContain("CTO");
  });
});
