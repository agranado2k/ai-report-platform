// Unit tests for the CORS seam (ADR-0063 API slice) — the view.<domain> →
// app.<domain> cross-origin allow-list. Pure: given a request Origin + the
// configured policy, decide which headers a response carries. SECURITY:
// never reflect an arbitrary Origin, never echo when no origin is configured
// (fail closed, mirroring the edit-token secret's own fail-closed posture),
// and never set Access-Control-Allow-Credentials (auth rides a Bearer
// header, not cookies — ADR-0063).
import { describe, expect, it } from "vitest";
import { corsPreflightResponse, corsResponseHeaders, mergeVary } from "./cors";

const VIEW_ORIGIN = "https://view.example.com";

describe("corsResponseHeaders", () => {
  it("echoes the configured origin back when the request Origin matches exactly", () => {
    const headers = corsResponseHeaders(VIEW_ORIGIN, { allowedOrigin: VIEW_ORIGIN });
    expect(headers).toEqual({ "Access-Control-Allow-Origin": VIEW_ORIGIN });
  });

  it("does NOT echo a non-matching origin", () => {
    const headers = corsResponseHeaders("https://evil.example.com", { allowedOrigin: VIEW_ORIGIN });
    expect(headers).toEqual({});
  });

  it("does NOT echo when there is no Origin header at all", () => {
    const headers = corsResponseHeaders(null, { allowedOrigin: VIEW_ORIGIN });
    expect(headers).toEqual({});
  });

  it("never echoes ANY origin when unconfigured (undefined allowedOrigin — fail closed)", () => {
    const headers = corsResponseHeaders(VIEW_ORIGIN, { allowedOrigin: undefined });
    expect(headers).toEqual({});
  });

  it("is never satisfied by a wildcard-shaped or reflected value — exact string match only", () => {
    // A near-miss (trailing slash, different scheme, subdomain) must NOT match.
    expect(
      corsResponseHeaders("https://view.example.com/", { allowedOrigin: VIEW_ORIGIN }),
    ).toEqual({});
    expect(corsResponseHeaders("http://view.example.com", { allowedOrigin: VIEW_ORIGIN })).toEqual(
      {},
    );
    expect(
      corsResponseHeaders("https://evil.view.example.com", { allowedOrigin: VIEW_ORIGIN }),
    ).toEqual({});
  });

  it("never sets Access-Control-Allow-Credentials, even on a match", () => {
    const headers = corsResponseHeaders(VIEW_ORIGIN, { allowedOrigin: VIEW_ORIGIN });
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});

describe("corsPreflightResponse", () => {
  it("returns 204 with no body", () => {
    const res = corsPreflightResponse(VIEW_ORIGIN, {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, POST, OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("carries Allow-Headers (Authorization, Content-Type) and Allow-Methods on a matching origin", () => {
    const res = corsPreflightResponse(VIEW_ORIGIN, {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, POST, OPTIONS",
    });
    expect(res.headers).toEqual({
      "Access-Control-Allow-Origin": VIEW_ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
    });
  });

  it("advertises a preflight cache lifetime (Access-Control-Max-Age) — origin-independent", () => {
    // Present even on a non-matching origin: it caches only the method/header
    // allow-list, never a credential, so it can't be used to probe config.
    const match = corsPreflightResponse(VIEW_ORIGIN, {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, OPTIONS",
    });
    const noMatch = corsPreflightResponse("https://evil.example.com", {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, OPTIONS",
    });
    expect(match.headers?.["Access-Control-Max-Age"]).toBe("600");
    expect(noMatch.headers?.["Access-Control-Max-Age"]).toBe("600");
  });

  it("omits Access-Control-Allow-Origin (but still answers 204) when the origin doesn't match", () => {
    const res = corsPreflightResponse("https://evil.example.com", {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBeUndefined();
    // Allow-Headers/Allow-Methods are harmless to advertise even to a
    // non-matching origin — the browser only honors the preflight when
    // Allow-Origin ALSO matches, so this can't be used to probe config.
    expect(res.headers?.["Access-Control-Allow-Headers"]).toBe("Authorization, Content-Type");
  });

  it("never sets Access-Control-Allow-Credentials on the preflight either", () => {
    const res = corsPreflightResponse(VIEW_ORIGIN, {
      allowedOrigin: VIEW_ORIGIN,
      allowedMethods: "GET, OPTIONS",
    });
    expect(res.headers?.["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});

describe("mergeVary", () => {
  it("returns the token alone when there is no existing Vary", () => {
    expect(mergeVary(null, "Origin")).toBe("Origin");
    expect(mergeVary("", "Origin")).toBe("Origin");
  });

  it("appends the token, preserving an existing Vary (no clobber → no cache poisoning)", () => {
    expect(mergeVary("Accept-Encoding", "Origin")).toBe("Accept-Encoding, Origin");
    expect(mergeVary("Accept-Encoding, Cookie", "Origin")).toBe("Accept-Encoding, Cookie, Origin");
  });

  it("dedupes case-insensitively — never adds Origin twice", () => {
    expect(mergeVary("origin", "Origin")).toBe("origin");
    expect(mergeVary("Accept-Encoding, ORIGIN", "Origin")).toBe("Accept-Encoding, ORIGIN");
  });
});
