import { describe, expect, it } from "vitest";
import { clerkAuthServerOrigin, mintSessionToken, protectedResourceMetadata } from "./clerk";

function stub(...responses: Response[]) {
  const calls: { url: string; method: string; body: string }[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? String(init.body) : "",
    });
    return responses[i++] as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mintSessionToken", () => {
  it("creates a session for the user, then mints a token, returning the JWT", async () => {
    const { fn, calls } = stub(json({ id: "sess_1" }), json({ jwt: "the.jwt.value" }));
    const jwt = await mintSessionToken("user_123", { secretKey: "sk_test_x", fetch: fn });

    expect(jwt).toBe("the.jwt.value");
    // 1) POST /sessions with user_id
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.clerk.com/v1/sessions");
    expect(calls[0]?.body).toContain("user_id=user_123");
    // 2) POST /sessions/{id}/tokens
    expect(calls[1]?.url).toBe("https://api.clerk.com/v1/sessions/sess_1/tokens");
  });

  it("throws if Clerk rejects the session creation", async () => {
    const { fn } = stub(json({ errors: [] }, 422));
    await expect(mintSessionToken("user_123", { secretKey: "sk", fetch: fn })).rejects.toThrow(
      /createSession/,
    );
  });
});

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
