import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "./client";
import { OVERCLAIM_PATTERNS } from "./instructions";
import { registerPrompts } from "./prompts";
import { buildMcpServer } from "./server";

type PromptCallback = (args: Record<string, unknown>) => GetPromptResult | Promise<GetPromptResult>;

interface RegisteredPromptConfig {
  readonly title?: string;
  readonly description?: string;
  readonly argsSchema?: Record<string, unknown>;
}

interface CollectedPrompt {
  readonly config: RegisteredPromptConfig;
  readonly callback: PromptCallback;
}

/** Collect the prompts `registerPrompts` registers, keyed by name — mirrors tools.test.ts's
 *  `collectTools`, since the SDK exposes no public getter for a server's registered prompts. */
function collectPrompts(): Map<string, CollectedPrompt> {
  const prompts = new Map<string, CollectedPrompt>();
  const fakeServer = {
    registerPrompt(name: string, config: RegisteredPromptConfig, callback: PromptCallback) {
      prompts.set(name, { config, callback });
    },
  } as unknown as McpServer;
  registerPrompts(fakeServer);
  return prompts;
}

function textOf(result: GetPromptResult): string {
  const first = result.messages[0]?.content;
  return first?.type === "text" ? first.text : "";
}

describe("registerPrompts (ADR-0072, Layer 2)", () => {
  it("registers exactly the three discoverable entry-point prompts", () => {
    const prompts = collectPrompts();
    expect([...prompts.keys()].sort()).toEqual(["find_report", "publish_report", "share_report"]);
  });

  it("every prompt has a non-empty title and description", () => {
    for (const { config } of collectPrompts().values()) {
      expect(config.title?.length ?? 0).toBeGreaterThan(0);
      expect(config.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("publish_report references reports_upload, forwards the source, and mentions view_url", async () => {
    const prompt = collectPrompts().get("publish_report");
    expect(prompt).toBeDefined();
    const result = await prompt?.callback({ source: "<html>hi</html>" });
    const text = textOf(result as GetPromptResult);
    expect(text).toMatch(/reports_upload/);
    expect(text).toMatch(/view_url/);
    expect(text).toContain("<html>hi</html>");
  });

  it("publish_report forwards an optional title via reports_update", async () => {
    const prompt = collectPrompts().get("publish_report");
    const result = await prompt?.callback({ source: "<html></html>", title: "Q3 results" });
    const text = textOf(result as GetPromptResult);
    expect(text).toMatch(/reports_update/);
    expect(text).toContain("Q3 results");
  });

  it("share_report references the real ACL and write-grant tool names, and forwards the slug", async () => {
    const prompt = collectPrompts().get("share_report");
    expect(prompt).toBeDefined();
    const result = await prompt?.callback({ slug: "q3-results" });
    const text = textOf(result as GetPromptResult);
    expect(text).toMatch(/reports_get_acl/);
    expect(text).toMatch(/reports_set_acl/);
    expect(text).toMatch(/reports_grant_write/);
    expect(text).toMatch(/reports_revoke_write/);
    expect(text).toMatch(/reports_list_write_grants/);
    expect(text).toContain("q3-results");
  });

  it("find_report references reports_search/reports_get and forwards the query", async () => {
    const prompt = collectPrompts().get("find_report");
    expect(prompt).toBeDefined();
    const result = await prompt?.callback({ query: "Q3" });
    const text = textOf(result as GetPromptResult);
    expect(text).toMatch(/reports_search/);
    expect(text).toMatch(/reports_get/);
    expect(text).toContain("Q3");
  });

  it("no prompt over-claims cross-user/org access (ADR-0069)", async () => {
    const argsByPrompt: Record<string, Record<string, unknown>> = {
      publish_report: { source: "<html></html>" },
      share_report: { slug: "abc12345" },
      find_report: { query: "x" },
    };
    for (const [name, prompt] of collectPrompts()) {
      const result = await prompt.callback(argsByPrompt[name] ?? {});
      const text = textOf(result);
      for (const pattern of OVERCLAIM_PATTERNS) expect(text).not.toMatch(pattern);
    }
  });

  it("share_report states the caller-scoped-access caveat explicitly", async () => {
    const share = collectPrompts().get("share_report");
    const shareText = textOf((await share?.callback({ slug: "abc" })) as GetPromptResult);
    expect(shareText).toMatch(/own|never another/i);
  });

  it("find_report states the caller-scoped-access caveat explicitly", async () => {
    const find = collectPrompts().get("find_report");
    const findText = textOf((await find?.callback({ query: "x" })) as GetPromptResult);
    expect(findText).toMatch(/own|never another/i);
  });

  it("publish_report frames the untrusted source as data, not instructions (ADR-0069)", async () => {
    const prompt = collectPrompts().get("publish_report");
    const text = textOf((await prompt?.callback({ source: "<html></html>" })) as GetPromptResult);
    expect(text).toMatch(/data, not instructions/i);
  });

  it("declares the expected argument on each prompt's argsSchema", () => {
    const prompts = collectPrompts();
    expect(Object.keys(prompts.get("publish_report")?.config.argsSchema ?? {})).toEqual(
      expect.arrayContaining(["source", "title"]),
    );
    expect(Object.keys(prompts.get("share_report")?.config.argsSchema ?? {})).toEqual(["slug"]);
    expect(Object.keys(prompts.get("find_report")?.config.argsSchema ?? {})).toEqual(["query"]);
  });
});

describe("buildMcpServer wiring of prompts (ADR-0072, Layer 2)", () => {
  const stubClient = {} as ApiClient;

  // The SDK's McpServer has no public getter for its registered prompts (only a
  // private `_registeredPrompts` field, TS-private not JS-`#private`) — read it
  // back the same way server.test.ts reads `_instructions`, to prove
  // `buildMcpServer` actually calls `registerPrompts`.
  function registeredPromptNames(server: ReturnType<typeof buildMcpServer>): string[] {
    const prompts = (server as unknown as { _registeredPrompts?: Record<string, unknown> })
      ._registeredPrompts;
    return Object.keys(prompts ?? {});
  }

  it("registers the three prompts on a server built by buildMcpServer", () => {
    const server = buildMcpServer(stubClient);
    expect(registeredPromptNames(server).sort()).toEqual([
      "find_report",
      "publish_report",
      "share_report",
    ]);
  });
});
