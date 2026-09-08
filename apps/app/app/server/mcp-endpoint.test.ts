import { describe, expect, it } from "vitest";
import { mcpEndpointFrom } from "./mcp-endpoint";

// The MCP server lives at `mcp.<apex>`, a sibling of this app at `app.<apex>`
// (ADR-0051). Deriving its `/mcp` endpoint from the app origin is pure string
// work over the origin; kept here so both the settings route and the ⌘K palette
// (which offers "Copy MCP endpoint") share ONE derivation.

describe("mcpEndpointFrom", () => {
  it("swaps the app.<apex> host to mcp.<apex> and sets /mcp", () => {
    expect(mcpEndpointFrom("https://app.centaurspec.com")).toBe("https://mcp.centaurspec.com/mcp");
  });
  it("is a host swap only — a non app.* origin keeps its host (preview/apex)", () => {
    expect(mcpEndpointFrom("https://arp-app-pr-12.vercel.app")).toBe(
      "https://arp-app-pr-12.vercel.app/mcp",
    );
  });
  it("preserves the scheme and drops any existing path/query", () => {
    expect(mcpEndpointFrom("http://app.localhost:3000/settings?x=1")).toBe(
      "http://mcp.localhost:3000/mcp",
    );
  });
});
