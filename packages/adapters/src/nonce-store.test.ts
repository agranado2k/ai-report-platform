import { describe, expect, it, vi } from "vitest";
import { UpstashNonceStore } from "./nonce-store";

const upstashOk = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 });

function makeSender(fetchImpl: typeof fetch) {
  return new UpstashNonceStore({
    url: "https://us.upstash.io",
    token: "tok",
    fetchImpl,
  });
}

describe("UpstashNonceStore (ADR-0056/0011)", () => {
  it("put issues SET <key> <value> EX <ttl> with Bearer auth", async () => {
    const fetchImpl = vi.fn(async () => upstashOk("OK"));
    const store = makeSender(fetchImpl as unknown as typeof fetch);

    const r = await store.put("abc", "payload", 900);
    expect(r.ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.upstash.io");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(["SET", "nonce:abc", "payload", "EX", 900]);
  });

  it("take issues GETDEL and returns the value (single-use)", async () => {
    const fetchImpl = vi.fn(async () => upstashOk("payload"));
    const store = makeSender(fetchImpl as unknown as typeof fetch);

    const r = await store.take("abc");
    expect(r.ok && r.value).toBe("payload");
    expect(
      JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual(["GETDEL", "nonce:abc"]);
  });

  it("take returns null when the nonce is absent / already consumed", async () => {
    const store = makeSender(vi.fn(async () => upstashOk(null)) as unknown as typeof fetch);
    const r = await store.take("gone");
    expect(r.ok && r.value).toBe(null);
  });

  it("maps an HTTP error and an Upstash error body to a Result error", async () => {
    const httpErr = makeSender(
      vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    );
    expect((await httpErr.put("a", "v", 1)).ok).toBe(false);

    const bodyErr = makeSender(
      vi.fn(
        async () => new Response(JSON.stringify({ error: "WRONGPASS" }), { status: 200 }),
      ) as unknown as typeof fetch,
    );
    expect((await bodyErr.take("a")).ok).toBe(false);
  });
});
