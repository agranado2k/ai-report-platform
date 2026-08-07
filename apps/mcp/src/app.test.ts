import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, MAX_JSON_BODY_BYTES, type OAuthDeps } from "./app";

// pk = pk_(test|live)_ + base64(frontendApiHost + "$")
const PK = `pk_test_${btoa("clerk.example.com$")}`;

beforeAll(() => {
  process.env.APP_ORIGIN = "https://api.test";
  process.env.MCP_ORIGIN = "https://mcp.test";
  // Make the "OAuth disabled" path deterministic even if the dev shell exports
  // Clerk secrets — the enabled tests inject their own OAuth deps regardless.
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
});

const metadataPath = "/.well-known/oauth-protected-resource/mcp";
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const postMcp = (app: ReturnType<typeof createApp>, auth?: string) => {
  const r = request(app)
    .post("/mcp")
    .set("accept", "application/json, text/event-stream")
    .set("content-type", "application/json");
  if (auth) r.set("authorization", auth);
  return r;
};

describe("createApp — OAuth disabled (no Clerk keys)", () => {
  it("GET /health → 200", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("no metadata route when OAuth is off → 404", async () => {
    const res = await request(createApp()).get(metadataPath);
    expect(res.status).toBe(404);
  });

  it("POST /mcp with no credential → 401, no WWW-Authenticate (OAuth off)", async () => {
    const res = await postMcp(createApp()).send(toolsList);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("POST /mcp with an arp_ key → 200 tools/list (forwarded, no network)", async () => {
    const res = await postMcp(createApp(), "Bearer arp_live_x").send(toolsList);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("reports_search");
  });

  it("accepts a JSON body well above Express's 100kb default (large reports_upload html)", async () => {
    // A reports_upload call carries the whole HTML document inside the JSON-RPC
    // body; Express's default json() limit (100kb) 413'd real uploads at ~85-100KB
    // of HTML. Pad a tools/list request past that threshold to pin the raised limit.
    const bigBody = { ...toolsList, params: { _meta: { pad: "x".repeat(500_000) } } };
    const res = await postMcp(createApp(), "Bearer arp_live_x").send(bigBody);
    expect(res.status).toBe(200);
  });

  it("rejects a body over the cap with the app's JSON error shape, not Express's HTML page", async () => {
    const bigBody = {
      ...toolsList,
      params: { _meta: { pad: "x".repeat(MAX_JSON_BODY_BYTES + 1024) } },
    };
    const res = await postMcp(createApp(), "Bearer arp_live_x").send(bigBody);
    expect(res.status).toBe(413);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toMatch(/too large/i);
  });

  it("rejects malformed JSON with the app's JSON error shape, not Express's HTML page", async () => {
    const res = await postMcp(createApp(), "Bearer arp_live_x").send('{"jsonrpc": "2.0", broken');
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toMatch(/invalid json/i);
  });

  it("rejects an unauthenticated over-limit request with 401 — credentials before buffering", async () => {
    // The credential check reads only headers; running it before the body parser
    // means anonymous callers can't make the function buffer multi-MB bodies.
    const bigBody = {
      ...toolsList,
      params: { _meta: { pad: "x".repeat(MAX_JSON_BODY_BYTES + 1024) } },
    };
    const res = await postMcp(createApp()).send(bigBody);
    expect(res.status).toBe(401);
  });

  it("survives a client abort mid-drain — no unhandled stream error", async () => {
    // An anonymous upload that dies partway lands in the 401 drain path; the
    // request stream then errors, which must not crash the process.
    const server = createApp().listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((resolve) => {
        const req = http.request({
          port,
          method: "POST",
          path: "/mcp",
          headers: {
            "content-type": "application/json",
            "content-length": String(MAX_JSON_BODY_BYTES),
          },
        });
        req.on("error", () => resolve()); // our own destroy() surfaces client-side
        req.on("response", () => resolve());
        req.write('{"jsonrpc":"2.0",');
        setTimeout(() => req.destroy(), 25);
      });
      // The server must still be serviceable after the aborted request.
      const res = await request(server).get("/health");
      expect(res.status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("createApp — OAuth enabled (injected deps)", () => {
  const make = (over?: Partial<OAuthDeps>) =>
    createApp({
      publishableKey: PK,
      verifyUser: async (auth) => (auth.includes("good") ? "user_1" : null),
      ...over,
    });

  it("serves cacheable RFC-9728 metadata pointing at the Clerk auth server", async () => {
    const res = await request(make()).get(metadataPath);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("public"); // not the global no-store
    expect(res.body.resource).toBe("https://mcp.test/mcp");
    expect(res.body.authorization_servers).toEqual(["https://clerk.example.com"]);
  });

  it("POST /mcp with no credential → 401 + WWW-Authenticate discovery", async () => {
    const res = await postMcp(make()).send(toolsList);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain(
      `resource_metadata="https://mcp.test${metadataPath}"`,
    );
  });

  it("valid OAuth token → verify → forward it → 200 tools/list", async () => {
    const res = await postMcp(make(), "Bearer good-oauth").send(toolsList);
    expect(res.status).toBe(200);
  });

  it("invalid OAuth token → 401", async () => {
    const res = await postMcp(make(), "Bearer bad-oauth").send(toolsList);
    expect(res.status).toBe(401);
  });
});
