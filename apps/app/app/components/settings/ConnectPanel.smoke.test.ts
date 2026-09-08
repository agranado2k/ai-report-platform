// Node-render smoke for the "Connect to Claude" hero panel (#338, report §04).
// Pure — no Remix. Pins that the MCP endpoint is shown verbatim with a copy
// affordance and a setup-guide link (the thing people come to this page for).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectPanel } from "./ConnectPanel";

const endpoint = "https://mcp.centaurspec.com/mcp";
const html = renderToStaticMarkup(h(ConnectPanel, { endpoint }));

describe("ConnectPanel", () => {
  it("headlines Connect to Claude and labels it MCP", () => {
    expect(html).toContain("Connect to Claude");
    expect(html).toContain("MCP");
  });
  it("shows the endpoint verbatim with a copy button", () => {
    expect(html).toContain(endpoint);
    // CopyButton renders a button whose aria-label mentions copy.
    expect(html).toMatch(/aria-label="Copy to clipboard"/);
  });
  it("links out to a setup guide", () => {
    expect(html).toContain("Setup guide");
  });
});
