// Behavior tests for saveEdit — the client-side save-fetch helper behind the
// in-viewer editor's Save button (ADR-0063 Phase 4). No DOM/React needed: a
// fake `fetchImpl` is injected so the request shape (URL, method, headers,
// credentials, body) and the response-mapping (success / expired-token /
// other-error) are all assertable without a browser.
import type { PMDocJson } from "arp-report-html";
import { describe, expect, it, vi } from "vitest";
import { saveEdit } from "./save-edit";

const DOC = { type: "doc", content: [] } as unknown as PMDocJson;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("saveEdit", () => {
  it("POSTs to <appOrigin>/api/v1/reports/<slug>/versions with a Bearer edit token, credentials omitted, JSON body { doc }", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { version: 3, scan_status: "pending" }));

    await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/versions");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok.sig");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ doc: DOC });
  });

  it("maps a 201 response to an ok result carrying the new version + scan status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { version: 4, scan_status: "clean" }));

    const result = await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, version: 4, scanStatus: "clean" });
  });

  it("maps a 401 response to an expired-session error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));

    const result = await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
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

    const result = await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps any other non-2xx response to a non-expired error, carrying the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { error: "validation" }));

    const result = await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expired).toBe(false);
      expect(result.message).toContain("422");
    }
  });

  it("maps a network-level failure (fetch rejects) to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));

    const result = await saveEdit({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      doc: DOC,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });
});
