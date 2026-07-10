import { describe, expect, it, vi } from "vitest";
import { listVersions } from "./versions-client";
import type { VersionWire } from "./wire-types";

const VERSION: VersionWire = {
  object: "version",
  id: "version_1",
  version_no: 3,
  uploaded_by: "user_1",
  uploaded_at: "2026-07-08T00:00:00.000Z",
  scan_status: "clean",
  size_bytes: 4096,
  origin: "editor",
  mode: "prod",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("listVersions", () => {
  it("GETs the versions list with a Bearer edit token, credentials omitted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object: "list", data: [VERSION], has_more: false }));

    const result = await listVersions({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/versions?limit=100");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok.sig");
    expect(result).toEqual({ ok: true, versions: [VERSION] });
  });

  it("maps a 401/403 to an expired-session failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const result = await listVersions({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps any other non-ok response to a non-expired, status-carrying error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const result = await listVersions({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expired).toBe(false);
      expect(result.message).toContain("500");
    }
  });

  it("maps a network-level failure to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await listVersions({
      appOrigin: "https://app.centaurspec.com",
      slug: "abc1234567",
      editToken: "tok.sig",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });
});
