import { describe, expect, it } from "vitest";
import type { ApiClient } from "./client";
import { INSTRUCTIONS } from "./instructions";
import { buildMcpServer } from "./server";

// Never a real client here — buildMcpServer only wires tool registration
// against it, and instructions are static, so an empty stub is enough.
const stubClient = {} as ApiClient;

describe("instructions constant (ADR-0072, Layer 0)", () => {
  it("is a short, non-empty behavioral nudge (not a manifesto)", () => {
    expect(INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(INSTRUCTIONS.length).toBeLessThan(1000);
  });

  it("teaches the core workflow verbs: upload, versioning, folders, comments", () => {
    expect(INSTRUCTIONS).toMatch(/upload/i);
    expect(INSTRUCTIONS).toMatch(/version|re-upload/i);
    expect(INSTRUCTIONS).toMatch(/folder/i);
    expect(INSTRUCTIONS).toMatch(/comment/i);
  });

  it("does NOT over-claim access beyond the caller's own grants (ADR-0069)", () => {
    // Must not read as "this server can reach other users'/orgs' data".
    expect(INSTRUCTIONS).not.toMatch(/any (user|org|report)/i);
    expect(INSTRUCTIONS).not.toMatch(/all (users|orgs|reports)/i);
    expect(INSTRUCTIONS).not.toMatch(/every (user|org)/i);
    // Should instead be scoped to the caller.
    expect(INSTRUCTIONS).toMatch(/your own|caller|never (another|other)/i);
  });
});

// The SDK's McpServer/Server classes have no public getter for `instructions`
// (only a `private _instructions?` field, TS-private not JS-`#private`, so
// it's a plain runtime property) — read it back the same way the SDK itself
// stores it, to prove `buildMcpServer` actually wires the constant through.
function instructionsOf(server: ReturnType<typeof buildMcpServer>): string | undefined {
  return (server.server as unknown as { _instructions?: string })._instructions;
}

describe("buildMcpServer", () => {
  it("sets the server's instructions to the exported INSTRUCTIONS constant", () => {
    const server = buildMcpServer(stubClient);
    const instructions = instructionsOf(server);
    expect(instructions).toBe(INSTRUCTIONS);
  });

  it("produces a server whose instructions is set and non-empty", () => {
    const instructions = instructionsOf(buildMcpServer(stubClient));
    expect(instructions).toBeDefined();
    expect(instructions?.length).toBeGreaterThan(0);
  });

  it("wired instructions mention the core workflow", () => {
    const instructions = instructionsOf(buildMcpServer(stubClient)) ?? "";
    expect(instructions).toMatch(/upload/i);
    expect(instructions).toMatch(/version|re-upload/i);
    expect(instructions).toMatch(/folder/i);
    expect(instructions).toMatch(/comment/i);
  });

  it("wired instructions do not over-claim access beyond the caller's own grants", () => {
    const instructions = instructionsOf(buildMcpServer(stubClient)) ?? "";
    expect(instructions).not.toMatch(/any (user|org|report)/i);
    expect(instructions).not.toMatch(/all (users|orgs|reports)/i);
  });
});
