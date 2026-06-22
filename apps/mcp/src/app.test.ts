import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, type OAuthDeps } from "./app";

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
});

describe("createApp — OAuth enabled (injected deps)", () => {
  const make = (over?: Partial<OAuthDeps>) =>
    createApp({
      publishableKey: PK,
      verifyUser: async (auth) => (auth.includes("good") ? "user_1" : null),
      mintSessionToken: async (u) => `jwt-${u}`,
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

  it("valid OAuth token → verify + mint session token → 200 tools/list", async () => {
    const res = await postMcp(make(), "Bearer good-oauth").send(toolsList);
    expect(res.status).toBe(200);
  });

  it("invalid OAuth token → 401", async () => {
    const res = await postMcp(make(), "Bearer bad-oauth").send(toolsList);
    expect(res.status).toBe(401);
  });

  it("session-mint failure → clean 502 (not a bare 500)", async () => {
    const app = make({
      mintSessionToken: async () => {
        throw new Error("clerk unavailable");
      },
    });
    const res = await postMcp(app, "Bearer good-oauth").send(toolsList);
    expect(res.status).toBe(502);
  });

  it("caches the minted token per user — mints once across repeated requests", async () => {
    const mint = vi.fn(async (u: string) => `jwt-${u}`);
    const app = make({ mintSessionToken: mint });
    await postMcp(app, "Bearer good-oauth").send(toolsList);
    await postMcp(app, "Bearer good-oauth").send(toolsList);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
