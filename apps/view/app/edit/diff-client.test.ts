import { describe, expect, it, vi } from "vitest";
import { getDiff } from "./diff-client";
import type { DiffWire } from "./wire-types";

const DIFF: DiffWire = {
  object: "report_diff",
  diff_mode: "structural",
  html: '<p>Revenue grew <span class="rd-diff-ins">12%</span></p>',
  label: null,
  from: { id: "version_1", version_no: 1 },
  to: { id: "version_2", version_no: 2 },
  mode: "prod",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE = {
  appOrigin: "https://app.centaurspec.com",
  slug: "abc1234567",
  editToken: "tok.sig",
  fromVersionId: "version_1",
  toVersionId: "version_2",
};

describe("getDiff", () => {
  it("GETs the diff with 'from'/'to' query params, a Bearer edit token, credentials omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, DIFF));

    const result = await getDiff({ ...BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://app.centaurspec.com/api/v1/reports/abc1234567/diff",
    );
    expect(parsed.searchParams.get("from")).toBe("version_1");
    expect(parsed.searchParams.get("to")).toBe("version_2");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok.sig");
    expect(result).toEqual({ ok: true, diff: DIFF });
  });

  it("maps a 401/403 to an expired-session failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    const result = await getDiff({ ...BASE, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps a 404 (unknown version id) to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, {
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "version not found",
        code: "not_found",
      }),
    );
    const result = await getDiff({ ...BASE, fetchImpl });
    expect(result).toEqual({ ok: false, expired: false, message: "version not found" });
  });

  it("maps a network-level failure to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await getDiff({ ...BASE, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });
});
