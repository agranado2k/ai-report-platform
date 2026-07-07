import { describe, expect, it } from "vitest";
import { roundtripHtml } from "../src/lib/roundtrip";
import { l0Plugins } from "../src/editors/l0";

describe("L0 sanity", () => {
  it("round-trips a plain paragraph", async () => {
    const { output, value } = await roundtripHtml(
      "<p>Hello <strong>world</strong></p>",
      l0Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
    expect(output).toContain("Hello");
  });

  it("round-trips a chip span (unknown element)", async () => {
    const { output, value } = await roundtripHtml(
      '<div class="chips"><span class="chip chip-cto">CTO</span></div>',
      l0Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
  });

  it("round-trips a checklist", async () => {
    const { output, value } = await roundtripHtml(
      '<ul class="checklist"><li>one</li><li>two</li></ul>',
      l0Plugins(),
    );
    console.log("VALUE", JSON.stringify(value));
    console.log("OUTPUT", output);
  });
});
