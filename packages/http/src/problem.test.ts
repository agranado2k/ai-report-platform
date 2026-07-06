import { methodNotAllowed } from "arp-domain";
import { describe, expect, it } from "vitest";
import { errorToHttp } from "./problem";

describe("errorToHttp — MethodNotAllowed (one 405 wire shape, ADR-0040)", () => {
  it("renders a 405 RFC 9457 problem+json body", () => {
    const http = errorToHttp(methodNotAllowed("PATCH, DELETE"));
    expect(http.status).toBe(405);
    expect(http.contentType).toBe("application/problem+json");
    expect(http.body).toMatchObject({
      type: "about:blank",
      title: "Method not allowed",
      status: 405,
      code: "method_not_allowed",
    });
  });

  it("carries the allowed methods on the Allow response header", () => {
    const http = errorToHttp(methodNotAllowed("POST"));
    expect(http.headers).toEqual({ Allow: "POST" });
  });

  it("does not set an Allow header for other error kinds", () => {
    const http = errorToHttp({ kind: "NotFound", message: "nope" });
    expect(http.headers).toBeUndefined();
  });
});
