import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "./client";
import {
  okResult,
  problemResult,
  registerReadTools,
  registerWriteTools,
  toToolResult,
} from "./tools";

const textOf = (r: { content: readonly unknown[] }) => (r.content[0] as { text: string }).text;

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface RegisteredTool {
  readonly config: {
    readonly annotations?: Record<string, unknown>;
    readonly inputSchema: Record<string, unknown>;
  };
  readonly handler: Handler;
}

/** Collect the tools a `register*` fn registers, keyed by name, so we can invoke a
 *  single tool's handler with a recording client (mirrors how server.ts wires them). */
function collectTools(
  register: (server: McpServer, client: ApiClient) => void,
  client: ApiClient,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool(name: string, config: RegisteredTool["config"], handler: Handler) {
      tools.set(name, { config, handler });
    },
  } as unknown as McpServer;
  register(fakeServer, client);
  return tools;
}

/** A recording ApiClient: each call pushes `{ method, args }` and returns `ok`. */
function recordingClient(result: ApiResult<unknown> = { ok: true, data: { ok: 1 } }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, method: string) {
      return (...args: unknown[]) => {
        calls.push({ method, args });
        return Promise.resolve(result);
      };
    },
  };
  return { client: new Proxy({}, handler) as unknown as ApiClient, calls };
}

describe("tool result mapping", () => {
  it("okResult returns pretty JSON text plus structuredContent for an object", () => {
    const r = okResult({ total: 3 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(textOf(r)).toContain('"total": 3');
    expect(r.structuredContent).toEqual({ total: 3 });
  });

  it("okResult omits structuredContent for a non-object payload", () => {
    const r = okResult("plain");
    expect(r.structuredContent).toBeUndefined();
  });

  it("okResult omits structuredContent for an array payload (it's an object map, not a list)", () => {
    expect(okResult([1, 2, 3]).structuredContent).toBeUndefined();
  });

  it("okResult renders a friendly ack for a 204/no-content (undefined) result", () => {
    const r = okResult(undefined);
    expect(r.isError).toBeUndefined();
    expect((r.content[0] as { text: string }).text).toContain("OK");
    expect(r.structuredContent).toBeUndefined();
  });

  it("problemResult flags isError and renders status/code/detail", () => {
    const r = problemResult({
      title: "Unauthorized",
      status: 401,
      code: "unauthenticated",
      detail: "bad key",
    });
    expect(r.isError).toBe(true);
    const text = textOf(r);
    expect(text).toContain("401");
    expect(text).toContain("unauthenticated");
    expect(text).toContain("bad key");
  });

  it("toToolResult routes ok vs error", () => {
    expect(toToolResult({ ok: true, data: { x: 1 } }).isError).toBeUndefined();
    expect(toToolResult({ ok: false, problem: { title: "boom", status: 500 } }).isError).toBe(true);
  });
});

describe("comment tools", () => {
  it("reports_list_comments is READ-ONLY and maps slug + cursor to listComments", async () => {
    const { client, calls } = recordingClient({
      ok: true,
      data: { object: "list", data: [], has_more: false },
    });
    const tool = collectTools(registerReadTools, client).get("reports_list_comments");
    expect(tool).toBeDefined();
    expect(tool?.config.annotations?.readOnlyHint).toBe(true);

    const res = await tool?.handler({
      slug: "abc12345",
      limit: 5,
      starting_after: "comment_a",
      ending_before: "comment_z",
    });
    expect(res?.isError).toBeUndefined();
    expect(calls).toEqual([
      {
        method: "listComments",
        args: ["abc12345", { limit: 5, startingAfter: "comment_a", endingBefore: "comment_z" }],
      },
    ]);
  });

  it("reports_add_comment (root) maps body + anchor and is a non-read create", async () => {
    const { client, calls } = recordingClient({
      ok: true,
      data: { object: "comment", id: "comment_1" },
    });
    const tool = collectTools(registerWriteTools, client).get("reports_add_comment");
    expect(tool).toBeDefined();
    expect(tool?.config.annotations?.readOnlyHint).toBe(false);
    expect(tool?.config.annotations?.idempotentHint).toBe(false);

    await tool?.handler({
      slug: "abc12345",
      body: "What does this mean?",
      version_id: "version_1",
      text_quote: "the Q3 number",
    });
    expect(calls).toEqual([
      {
        method: "addComment",
        args: [
          "abc12345",
          {
            body: "What does this mean?",
            versionId: "version_1",
            textQuote: "the Q3 number",
            relative: undefined,
            parentCommentId: undefined,
          },
        ],
      },
    ]);
  });

  it("reports_add_comment (reply) forwards parent_comment_id + relative", async () => {
    const { client, calls } = recordingClient();
    const tool = collectTools(registerWriteTools, client).get("reports_add_comment");
    await tool?.handler({
      slug: "abc12345",
      body: "a reply",
      version_id: "version_1",
      text_quote: "quote",
      relative: { css: "#h" },
      parent_comment_id: "comment_1",
    });
    expect(calls[0]).toEqual({
      method: "addComment",
      args: [
        "abc12345",
        {
          body: "a reply",
          versionId: "version_1",
          textQuote: "quote",
          relative: { css: "#h" },
          parentCommentId: "comment_1",
        },
      ],
    });
  });

  it("reports_resolve_comment maps slug + comment_id and is idempotent mutate", async () => {
    const { client, calls } = recordingClient();
    const tool = collectTools(registerWriteTools, client).get("reports_resolve_comment");
    expect(tool).toBeDefined();
    expect(tool?.config.annotations?.readOnlyHint).toBe(false);
    expect(tool?.config.annotations?.idempotentHint).toBe(true);
    expect(tool?.config.annotations?.destructiveHint).toBe(false);

    await tool?.handler({ slug: "abc12345", comment_id: "comment_1" });
    expect(calls).toEqual([{ method: "resolveComment", args: ["abc12345", "comment_1"] }]);
  });

  it("reports_edit_comment maps slug + comment_id + fields and is a non-destructive mutate", async () => {
    const { client, calls } = recordingClient({
      ok: true,
      data: { object: "comment", id: "comment_1" },
    });
    const tool = collectTools(registerWriteTools, client).get("reports_edit_comment");
    expect(tool).toBeDefined();
    expect(tool?.config.annotations?.readOnlyHint).toBe(false);
    expect(tool?.config.annotations?.destructiveHint).toBe(false);
    expect(tool?.config.annotations?.idempotentHint).toBe(true);

    await tool?.handler({
      slug: "abc12345",
      comment_id: "comment_1",
      body: "fixed typo",
      intent: "enhancement",
    });
    expect(calls).toEqual([
      {
        method: "editComment",
        args: ["abc12345", "comment_1", { body: "fixed typo", intent: "enhancement" }],
      },
    ]);
  });

  it("reports_edit_comment forwards only the fields supplied (body-only edit)", async () => {
    const { client, calls } = recordingClient();
    const tool = collectTools(registerWriteTools, client).get("reports_edit_comment");
    await tool?.handler({ slug: "abc12345", comment_id: "comment_1", body: "just the body" });
    expect(calls[0]).toEqual({
      method: "editComment",
      args: ["abc12345", "comment_1", { body: "just the body", intent: undefined }],
    });
  });

  it("reports_delete_comment maps slug + comment_id and is destructive", async () => {
    const { client, calls } = recordingClient({ ok: true, data: undefined });
    const tool = collectTools(registerWriteTools, client).get("reports_delete_comment");
    expect(tool).toBeDefined();
    expect(tool?.config.annotations?.destructiveHint).toBe(true);

    const res = await tool?.handler({ slug: "abc12345", comment_id: "comment_1" });
    expect(res?.isError).toBeUndefined();
    expect(calls).toEqual([{ method: "deleteComment", args: ["abc12345", "comment_1"] }]);
  });

  it("a tool surfaces an upstream problem as an isError result", async () => {
    const { client } = recordingClient({
      ok: false,
      problem: { title: "Forbidden", status: 403, code: "forbidden" },
    });
    const tool = collectTools(registerWriteTools, client).get("reports_add_comment");
    const res = await tool?.handler({
      slug: "abc12345",
      body: "x",
      version_id: "version_1",
      text_quote: "q",
    });
    expect(res?.isError).toBe(true);
  });
});
