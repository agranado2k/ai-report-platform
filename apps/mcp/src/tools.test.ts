import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ACL_MODES, COMMENT_INTENTS, FOLDER_VISIBILITIES, REPORT_SHARING_STATES } from "arp-domain";
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
    /** The agent-facing description. Asserted on directly — for a tool an
     *  autonomous caller drives, the description IS the interface (ADR-0072). */
    readonly description?: string;
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

describe("onboarding-sharpened tool descriptions (ADR-0072, Layer 0)", () => {
  const descriptionOf = (name: string) =>
    (
      collectTools(registerWriteTools, {} as ApiClient).get(name)?.config as {
        description?: string;
      }
    )?.description ?? "";

  it("reports_upload explains the same-URL, new-version re-upload story", () => {
    const d = descriptionOf("reports_upload");
    expect(d).toMatch(/update_slug/);
    expect(d).toMatch(/view_url/);
    expect(d).toMatch(/same|unchanged/i);
  });

  // ADR-0062 Amendment 3: the platform RETAINS `id`/`target`/`rel` through
  // editing but never adds them for you (the deliberate "author decides"
  // choice — no serve-time or save-time HTML rewriting, ever). So the only
  // thing that makes a generated report's links behave like links is the
  // generator emitting them, and the `html` parameter's own description is
  // the one piece of guidance that reaches EVERY client — including hosts
  // that ignore the server `instructions` string entirely.
  it("the html parameter teaches the anchor + new-tab link conventions", () => {
    const html = (
      collectTools(registerWriteTools, {} as ApiClient).get("reports_upload")?.config
        .inputSchema as Record<string, { description?: string }>
    ).html?.description;
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/noopener noreferrer/);
    expect(html).toMatch(/href="#/);
    expect(html).toMatch(/\bid\b/);
  });

  // The correctness half of that guidance, pinned separately because getting
  // it WRONG is worse than omitting it: `id` is node-only (ADR-0062
  // Amendment 3, Decision 1), so telling a generator it can "anchor whatever
  // you need" teaches it to emit `<span id>` — a dead anchor after the first
  // save, i.e. exactly the regression class the amendment exists to close.
  it("the html parameter says anchors must target BLOCK elements, not marks", () => {
    const html = (
      collectTools(registerWriteTools, {} as ApiClient).get("reports_upload")?.config
        .inputSchema as Record<string, { description?: string }>
    ).html?.description;
    expect(html).toMatch(/block/i);
    expect(html).toMatch(/span/); // the mark elements are named, not implied
    expect(html).not.toMatch(/any element/i);
  });

  it("folders_create points to reports_move for organizing reports", () => {
    expect(descriptionOf("folders_create")).toMatch(/reports_move/);
  });

  it("folders_create states the ADR-0076 private-by-default rule and how to widen it", () => {
    const d = descriptionOf("folders_create");
    expect(d).toMatch(/private/i);
    expect(d).toMatch(/folders_share/);
    expect(d).toMatch(/folders_set_visibility/);
  });

  it("reports_move warns that an invisible destination folder reads as not-found", () => {
    const d = descriptionOf("reports_move");
    expect(d).toMatch(/visible/i);
    expect(d).toMatch(/not found|404/i);
  });

  it("reports_grant_write tells the caller to share the returned open_url with the grantee", () => {
    const d = descriptionOf("reports_grant_write");
    expect(d).toMatch(/open_url/);
    expect(d).toMatch(/grantee/);
  });
});

describe("reports_grant_write result pass-through", () => {
  it("carries the API's open_url through to the tool result (the grantee's editor entry)", async () => {
    const grantWire = {
      object: "write_grant",
      email: "grantee@x.com",
      granted_by: "user_abc",
      granted_at: "2026-08-01T00:00:00.000Z",
      open_url: "https://app.example.test/reports/abcde12345/open",
    };
    const { client, calls } = recordingClient({ ok: true, data: grantWire });
    const tools = collectTools(registerWriteTools, client);
    const result = await tools
      .get("reports_grant_write")
      ?.handler({ slug: "abcde12345", email: "grantee@x.com" });
    expect(calls).toEqual([{ method: "grantWrite", args: ["abcde12345", "grantee@x.com"] }]);
    expect(result?.structuredContent).toEqual(grantWire);
    expect(textOf(result as { content: readonly unknown[] })).toContain(
      "https://app.example.test/reports/abcde12345/open",
    );
  });
});

describe("shared schema vocabulary + cursor/slug helpers (wire-catalog refactor)", () => {
  const { client } = recordingClient();
  const readTools = collectTools(registerReadTools, client);
  const writeTools = collectTools(registerWriteTools, client);
  const schemaOf = (tools: Map<string, RegisteredTool>, tool: string, param: string) =>
    tools.get(tool)?.config.inputSchema[param] as {
      description?: string;
      options?: readonly string[];
      unwrap?: () => { options?: readonly string[] };
    };

  it("reports_set_acl's mode enum is exactly the arp-domain ACL_MODES vocabulary", () => {
    expect(schemaOf(writeTools, "reports_set_acl", "mode").options).toEqual([...ACL_MODES]);
  });

  it("reports_edit_comment's intent enum is exactly the arp-domain COMMENT_INTENTS vocabulary", () => {
    expect(schemaOf(writeTools, "reports_edit_comment", "intent")?.unwrap?.().options).toEqual([
      ...COMMENT_INTENTS,
    ]);
  });

  it("keeps the per-entity cursor descriptions verbatim on every paginated tool", () => {
    const cases: readonly (readonly [Map<string, RegisteredTool>, string, string])[] = [
      [readTools, "reports_search", "report"],
      [readTools, "reports_list_versions", "version"],
      [readTools, "reports_list_comments", "comment"],
      [readTools, "folders_list", "folder"],
    ];
    for (const [tools, tool, entity] of cases) {
      expect(schemaOf(tools, tool, "limit").description).toBe("Max items (1–100, default 20).");
      expect(schemaOf(tools, tool, "starting_after").description).toBe(
        `Cursor: a ${entity}_ id; returns items AFTER it (page forward).`,
      );
      expect(schemaOf(tools, tool, "ending_before").description).toBe(
        `Cursor: a ${entity}_ id; returns items BEFORE it (page back).`,
      );
    }
  });

  it("keeps the shared slug describe-string verbatim (slug-or-report_-id tools)", () => {
    // reports_get keeps its own variant ("… (from reports_search).") — not listed.
    const slugTools: readonly (readonly [Map<string, RegisteredTool>, string])[] = [
      [readTools, "reports_list_versions"],
      [readTools, "reports_get_acl"],
      [readTools, "reports_list_write_grants"],
      [readTools, "reports_list_comments"],
      [writeTools, "reports_update"],
      [writeTools, "reports_move"],
      [writeTools, "reports_set_acl"],
      [writeTools, "reports_set_sharing"],
      [writeTools, "reports_grant_write"],
      [writeTools, "reports_revoke_write"],
      [writeTools, "reports_add_comment"],
      [writeTools, "reports_resolve_comment"],
      [writeTools, "reports_edit_comment"],
      [writeTools, "reports_delete_comment"],
    ];
    for (const [tools, tool] of slugTools) {
      expect(schemaOf(tools, tool, "slug").description).toBe(
        "The report's slug or its report_ id.",
      );
    }
  });
});

describe("folder sharing tools (ADR-0076)", () => {
  it("folders_set_visibility calls setFolderVisibility with (id, visibility)", async () => {
    const { client, calls } = recordingClient();
    const tools = collectTools(registerWriteTools, client);
    await tools.get("folders_set_visibility")?.handler({ id: "folder_abc", visibility: "private" });
    expect(calls).toEqual([{ method: "setFolderVisibility", args: ["folder_abc", "private"] }]);
  });

  it("folders_set_visibility only offers the private|org enum", () => {
    const { client } = recordingClient();
    const tools = collectTools(registerWriteTools, client);
    const schema = tools.get("folders_set_visibility")?.config.inputSchema as {
      visibility: { options?: readonly string[] };
    };
    expect(schema.visibility.options).toEqual(["private", "org"]);
  });

  it("folders_share / folders_unshare call shareFolder / unshareFolder with (id, email)", async () => {
    const { client, calls } = recordingClient();
    const tools = collectTools(registerWriteTools, client);
    await tools.get("folders_share")?.handler({ id: "folder_abc", email: "pal@x.com" });
    await tools.get("folders_unshare")?.handler({ id: "folder_abc", email: "pal@x.com" });
    expect(calls).toEqual([
      { method: "shareFolder", args: ["folder_abc", "pal@x.com"] },
      { method: "unshareFolder", args: ["folder_abc", "pal@x.com"] },
    ]);
  });

  it("folders_list_shares is read-only and calls listFolderShares with the id", async () => {
    const { client, calls } = recordingClient();
    const tools = collectTools(registerReadTools, client);
    const tool = tools.get("folders_list_shares");
    expect(tool?.config.annotations).toMatchObject({ readOnlyHint: true });
    await tool?.handler({ id: "folder_abc" });
    expect(calls).toEqual([{ method: "listFolderShares", args: ["folder_abc"] }]);
  });

  it("descriptions spell out visibility-only semantics and the legacy-adoption story", () => {
    const writeDesc = (name: string) =>
      (
        collectTools(registerWriteTools, {} as ApiClient).get(name)?.config as {
          description?: string;
        }
      )?.description ?? "";
    expect(writeDesc("folders_set_visibility")).toMatch(/ADOPTED|adopts/i);
    expect(writeDesc("folders_set_visibility")).toMatch(/acl:write/);
    expect(writeDesc("folders_share")).toMatch(/NO rename|visibility/i);
    expect(writeDesc("folders_share")).toMatch(/acl:write/);
  });

  it("folders_share says a share is only effective for someone in the same org", () => {
    const d =
      (
        collectTools(registerWriteTools, {} as ApiClient).get("folders_share")?.config as {
          description?: string;
        }
      )?.description ?? "";
    expect(d).toMatch(/same org|their own org/i);
  });

  it("folders_set_visibility takes its enum from the domain vocabulary, not a hand-written list", () => {
    const tools = collectTools(registerWriteTools, {} as ApiClient);
    const schema = (
      tools.get("folders_set_visibility")?.config as {
        inputSchema?: Record<string, { options?: readonly string[] }>;
      }
    )?.inputSchema?.visibility;
    expect(schema?.options).toEqual([...FOLDER_VISIBILITIES]);
  });
});

// ── ADR-0078: the three-state sharing tools ────────────────────────────────
describe("report sharing tools (ADR-0078)", () => {
  const writeTools = collectTools(registerWriteTools, {} as ApiClient);

  it("reports_set_sharing takes its enum from the domain vocabulary, not a hand-written list", () => {
    // Inspect the TOOL's own enum — the sibling folders_set_visibility case
    // does exactly this. Asserting the domain enum against a literal and
    // separately that a schema key exists proves nothing about the tool: a
    // fourth state added to the domain, or a transcription typo in the tool,
    // would both pass.
    const schema = (
      writeTools.get("reports_set_sharing")?.config as {
        inputSchema?: Record<string, { options?: readonly string[] }>;
      }
    )?.inputSchema?.sharing;
    expect(schema?.options).toEqual([...REPORT_SHARING_STATES]);
  });

  it("folders_apply_sharing_to_reports takes the SAME domain enum", () => {
    const schema = (
      writeTools.get("folders_apply_sharing_to_reports")?.config as {
        inputSchema?: Record<string, { options?: readonly string[] }>;
      }
    )?.inputSchema?.sharing;
    expect(schema?.options).toEqual([...REPORT_SHARING_STATES]);
  });

  it("reports_set_sharing tells the agent that read and write are paired", () => {
    const d = writeTools.get("reports_set_sharing")?.config.description ?? "";
    expect(d).toMatch(/read and write are always paired/i);
    expect(d).toMatch(/delete stays owner-only/i);
  });

  it("reports_set_sharing tells the agent when NOT to use it", () => {
    // An agent that reached for this to set a password would be told to use
    // reports_set_acl; one that wanted to share with one person, to grant write.
    const d = writeTools.get("reports_set_sharing")?.config.description ?? "";
    expect(d).toContain("reports_set_acl");
    expect(d).toContain("reports_grant_write");
  });

  it("reports_set_sharing does not let an agent discard a password by default", () => {
    const d = writeTools.get("reports_set_sharing")?.config.description ?? "";
    expect(d).toMatch(/refuses/i);
    expect(d).toMatch(/confirm_discard/);
    expect(d).toMatch(/only if the user has agreed/i);
  });

  it("folders_apply_sharing_to_reports says the folder share does NOT reach the reports", () => {
    const d = writeTools.get("folders_apply_sharing_to_reports")?.config.description ?? "";
    expect(d).toMatch(/folder's NAME only/i);
    expect(d).toMatch(/only reports you own/i);
  });

  it("folders_apply_sharing_to_reports tells the agent to READ the skips before claiming success", () => {
    // The whole point of the honest partial result: an agent that reported
    // "done" off a 200 would be lying on the server's behalf.
    const d = writeTools.get("folders_apply_sharing_to_reports")?.config.description ?? "";
    expect(d).toMatch(/read `skipped` and `failed`/i);
  });

  it("both are MUTATE-annotated, not read-only", () => {
    expect(writeTools.get("reports_set_sharing")?.config.annotations?.readOnlyHint).toBe(false);
    expect(
      writeTools.get("folders_apply_sharing_to_reports")?.config.annotations?.readOnlyHint,
    ).toBe(false);
  });
});

describe("Editability is legible to an agent (ADR-0080)", () => {
  const readDescriptionOf = (name: string) =>
    (
      collectTools(registerReadTools, {} as ApiClient).get(name)?.config as {
        description?: string;
      }
    )?.description ?? "";
  const writeDescriptionOf = (name: string) =>
    (
      collectTools(registerWriteTools, {} as ApiClient).get(name)?.config as {
        description?: string;
      }
    )?.description ?? "";

  // MCP is this product's primary WRITE surface. An agent that just published
  // a document the editor cannot open must be able to learn that from the
  // response it already reads, not from a human clicking Edit days later.
  it("reports_upload names `editability` and what an un-editable upload means", () => {
    const d = writeDescriptionOf("reports_upload");
    expect(d).toMatch(/editability/);
    expect(d).toMatch(/unsplittable/);
    // The honest framing: it is not a failure — the report still views.
    expect(d).toMatch(/still (views|serves)|views fine/i);
  });

  it("reports_get names `editability` as a field it returns", () => {
    expect(readDescriptionOf("reports_get")).toMatch(/editability/);
  });

  it("reports_list_versions names `editability` per version", () => {
    expect(readDescriptionOf("reports_list_versions")).toMatch(/editability/);
  });

  it("never tells an agent that null means un-editable", () => {
    for (const d of [
      writeDescriptionOf("reports_upload"),
      readDescriptionOf("reports_get"),
      readDescriptionOf("reports_list_versions"),
    ]) {
      if (d.includes("editability")) expect(d).toMatch(/null|unknown/i);
    }
  });
});
