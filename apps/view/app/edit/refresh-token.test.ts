// Behavior tests for refreshEditToken (the silent-refresh client helper,
// ADR-0063 Phase 5) and nextRefreshDelayMs (the pure scheduling math behind
// the route component's refresh timer). No DOM/React needed for either: a
// fake `fetchImpl` is injected for the request-shape/response-mapping
// assertions, and nextRefreshDelayMs is plain arithmetic.
import { describe, expect, it, vi } from "vitest";
import { isEditTokenExpired, nextRefreshDelayMs, refreshEditToken } from "./refresh-token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("refreshEditToken", () => {
  it("POSTs to <appOrigin>/api/v1/reports/<slug>/edit-token with a Bearer edit token, credentials omitted, no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        object: "edit_token",
        edit_token: "tok2.sig",
        expires_at: 1_750_001_800,
      }),
    );

    await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/edit-token");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok1.sig");
    expect(init.body).toBeUndefined();
  });

  it("maps a 200 response to a fresh token + expiry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        object: "edit_token",
        edit_token: "tok2.sig",
        expires_at: 1_750_001_800,
      }),
    );

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, editToken: "tok2.sig", expiresAt: 1_750_001_800 });
  });

  it("maps a 401 response to an expired-session error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expired).toBe(true);
      expect(result.message).toMatch(/session.*expired/i);
    }
  });

  it("maps a 403 response to an expired-session error too (a revoked write grant)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps any other non-ok response to a non-expired, status-carrying error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expired).toBe(false);
      expect(result.message).toContain("500");
    }
  });

  it("maps a network-level failure (fetch rejects) to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });

  it("maps a 200 response with a malformed body to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { object: "edit_token" }));

    const result = await refreshEditToken({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok1.sig",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });
});

describe("nextRefreshDelayMs", () => {
  it("returns the time until expiry minus the skew margin, in ms", () => {
    // exp is 15 min (900s) out, skew is 2 min (120_000ms) — expect 13 min.
    expect(nextRefreshDelayMs(1_000_900, 1_000_000, 120_000)).toBe(13 * 60 * 1000);
  });

  it("clamps to 0 when already inside the skew margin", () => {
    // exp is 60s out, skew is 120_000ms (2 min) — well inside the margin.
    expect(nextRefreshDelayMs(1_000_060, 1_000_000, 120_000)).toBe(0);
  });

  it("clamps to 0 when the token has already expired", () => {
    expect(nextRefreshDelayMs(999_000, 1_000_000, 120_000)).toBe(0);
  });

  it("clamps to 0 exactly at the skew boundary", () => {
    // exp - now === skewMs/1000 exactly → 0, not negative.
    expect(nextRefreshDelayMs(1_000_120, 1_000_000, 120_000)).toBe(0);
  });
});

describe("isEditTokenExpired", () => {
  it("is false while the token is still before its expiry", () => {
    expect(isEditTokenExpired(1_000_900, 1_000_000)).toBe(false);
  });

  it("is true at or past the expiry — the signal to stop the offline retry loop", () => {
    expect(isEditTokenExpired(1_000_000, 1_000_000)).toBe(true); // exactly at exp
    expect(isEditTokenExpired(999_000, 1_000_000)).toBe(true); // past exp (offline client)
  });
});
