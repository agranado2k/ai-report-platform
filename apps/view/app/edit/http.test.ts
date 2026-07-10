import { describe, expect, it } from "vitest";
import { apiFailureFromResponse, networkFailure } from "./http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiFailureFromResponse", () => {
  it("maps 401 to an expired-session failure", async () => {
    const result = await apiFailureFromResponse(
      jsonResponse(401, { error: "unauthenticated" }),
      "Failed to load",
    );
    expect(result).toEqual({
      ok: false,
      expired: true,
      message: "Your editing session has expired — reopen this report from the dashboard.",
    });
  });

  it("maps 403 to an expired-session failure too (a revoked write grant)", async () => {
    const result = await apiFailureFromResponse(
      jsonResponse(403, { error: "forbidden" }),
      "Failed to load",
    );
    expect(result.expired).toBe(true);
  });

  it("prefers the problem+json 'detail' field for other statuses", async () => {
    const result = await apiFailureFromResponse(
      jsonResponse(422, {
        type: "about:blank",
        title: "Validation error",
        status: 422,
        detail: "anchor is required",
        code: "validation_error",
      }),
      "Failed to add comment",
    );
    expect(result).toEqual({ ok: false, expired: false, message: "anchor is required" });
  });

  it("falls back to a generic '<fallback> (<status>).' message when the body has no 'detail'", async () => {
    const result = await apiFailureFromResponse(jsonResponse(500, {}), "Failed to load versions");
    expect(result).toEqual({
      ok: false,
      expired: false,
      message: "Failed to load versions (500).",
    });
  });

  it("falls back gracefully when the error body isn't valid JSON", async () => {
    const response = new Response("not json", { status: 502 });
    const result = await apiFailureFromResponse(response, "Failed to load diff");
    expect(result).toEqual({ ok: false, expired: false, message: "Failed to load diff (502)." });
  });
});

describe("networkFailure", () => {
  it("builds a non-expired failure carrying the given message", () => {
    expect(networkFailure("offline")).toEqual({ ok: false, expired: false, message: "offline" });
  });
});
