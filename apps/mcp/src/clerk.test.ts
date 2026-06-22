import { describe, expect, it } from "vitest";
import { clerkAuthServerOrigin, protectedResourceMetadata } from "./clerk";

describe("clerkAuthServerOrigin / protectedResourceMetadata", () => {
  // pk = pk_(test|live)_ + base64(frontendApiHost + "$")
  const pk = `pk_live_${btoa("clerk.example.com$")}`;

  it("derives the Clerk frontend-API origin from a publishable key", () => {
    expect(clerkAuthServerOrigin(pk)).toBe("https://clerk.example.com");
  });

  it("builds RFC-9728 metadata pointing at the Clerk auth server", () => {
    const meta = protectedResourceMetadata("https://mcp.example.com/mcp", pk);
    expect(meta.resource).toBe("https://mcp.example.com/mcp");
    expect(meta.authorization_servers).toEqual(["https://clerk.example.com"]);
  });
});
