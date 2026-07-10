// Unit tests for the CORS route wrapper (ADR-0063 API slice) — the glue
// between the pure header math in arp-http's cors.ts and a real Remix
// loader/action: intercept OPTIONS before any auth runs, and attach
// Access-Control-Allow-Origin (+ Vary) to the real response.
import { describe, expect, it, vi } from "vitest";

const VIEW_ORIGIN = "https://view.example.com";

vi.mock("arp-env", () => ({
  defineEnv: () => ({ VIEW_ORIGIN }),
}));

// Imported AFTER the mock so corsRoute's module-level `defineEnv` read (inside
// its functions, called lazily per-request) picks up the mocked value.
const { corsRoute } = await import("./cors.server");

/** Mirrors the shape of Remix's LoaderFunctionArgs/ActionFunctionArgs enough
 *  for corsRoute's generic `Args extends { request: Request }` to infer the
 *  full shape at each call site (so `params`/`context` aren't flagged as
 *  excess properties). */
interface FakeArgs {
  readonly request: Request;
  readonly params: Record<string, string | undefined>;
  readonly context: unknown;
}

function req(url = "https://app.example.test/x", init?: RequestInit): Request {
  return new Request(url, init);
}

describe("corsRoute — OPTIONS preflight", () => {
  it("short-circuits an OPTIONS request BEFORE the wrapped handler ever runs (no auth on preflight)", async () => {
    const handler = vi.fn();
    const route = corsRoute<FakeArgs>("GET, POST, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", {
        method: "OPTIONS",
        headers: { Origin: VIEW_ORIGIN },
      }),
      params: {},
      context: {},
    });

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VIEW_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("still answers 204 on an OPTIONS from a non-configured origin, but WITHOUT Allow-Origin", async () => {
    const handler = vi.fn();
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example.com" },
      }),
      params: {},
      context: {},
    });

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("corsRoute — real requests", () => {
  it("attaches Access-Control-Allow-Origin to the wrapped handler's response when Origin matches", async () => {
    const handler = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", { headers: { Origin: VIEW_ORIGIN } }),
      params: {},
      context: {},
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VIEW_ORIGIN);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does NOT attach Access-Control-Allow-Origin when Origin doesn't match, but still returns the handler's response", async () => {
    const handler = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", {
        headers: { Origin: "https://evil.example.com" },
      }),
      params: {},
      context: {},
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("preserves the handler's own status/body on an error response (auth still gates the request)", async () => {
    const handler = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "unauthenticated" }), {
          status: 401,
          headers: { "Content-Type": "application/problem+json" },
        }),
    );
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", { headers: { Origin: VIEW_ORIGIN } }),
      params: {},
      context: {},
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(VIEW_ORIGIN);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("appends Origin to a Vary the handler already set, instead of clobbering it (no cache poisoning)", async () => {
    const handler = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { Vary: "Accept-Encoding" },
        }),
    );
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", { headers: { Origin: VIEW_ORIGIN } }),
      params: {},
      context: {},
    });

    // The handler's own Vary token survives; Origin is added, not substituted.
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });

  it("always sets Vary: Origin, even on a non-matching origin (cache correctness)", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", {
        headers: { Origin: "https://evil.example.com" },
      }),
      params: {},
      context: {},
    });

    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("never sets Access-Control-Allow-Credentials on a real response", async () => {
    const handler = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const route = corsRoute<FakeArgs>("GET, OPTIONS", handler);

    const res = await route({
      request: req("https://app.example.test/x", { headers: { Origin: VIEW_ORIGIN } }),
      params: {},
      context: {},
    });

    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
