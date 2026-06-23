import type { UploadOutcome } from "arp-application";
import { type AppError, err, ok, reportId, reportIdToWire } from "arp-domain";
import { describe, expect, it } from "vitest";
import { uploadResultToHttp } from "./upload-response";

const OPTS = { viewBaseUrl: "https://view.example", mode: "prod" as const };

const outcome = (over: Partial<UploadOutcome["result"]> = {}): UploadOutcome => ({
  result: { slug: "abcde12345", version: 1, scanStatus: "clean", ...over },
  replayed: false,
});

describe("uploadResultToHttp — success", () => {
  it("maps a fresh upload to 201 JSON with the canonical view URL + Location", () => {
    const res = uploadResultToHttp(ok(outcome()), OPTS);

    expect(res.status).toBe(201);
    expect(res.contentType).toBe("application/json");
    expect(res.body).toEqual({
      object: "report",
      slug: "abcde12345",
      // Canonical viewer URL: view.<domain>/<slug>, no /r/ prefix (ADR-002 / ADR-0038).
      view_url: "https://view.example/abcde12345",
      version: 1,
      scan_status: "clean",
      mode: "prod",
    });
    expect(res.headers?.Location).toBe("https://view.example/abcde12345");
  });

  it("returns the report_ External Id when the upload created a report (ADR-0052)", () => {
    const rid = reportId("019ed70f-491d-707a-a263-4c31243f0c9f");
    const res = uploadResultToHttp(ok({ ...outcome(), reportId: rid }), OPTS);
    expect((res.body as { id?: string }).id).toBe(reportIdToWire(rid));
  });
});

describe("uploadResultToHttp — errors (ADR-0040, RFC 9457)", () => {
  it("maps ValidationError to a 422 application/problem+json body", () => {
    const res = uploadResultToHttp(
      err({ kind: "ValidationError", message: "no entry document" }),
      OPTS,
    );

    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
    expect(res.body).toMatchObject({
      type: "about:blank",
      status: 422,
      code: "validation_error",
      detail: "no entry document",
    });
    expect((res.body as { title: string }).title).toBeTruthy();
  });

  // The full ADR-0040 / openapi `code` registry — every AppError kind maps to a
  // documented status + machine-readable code.
  const CASES: { error: AppError; status: number; code: string }[] = [
    { error: { kind: "Unauthenticated", message: "x" }, status: 401, code: "unauthenticated" },
    { error: { kind: "NotAllowed", message: "x" }, status: 403, code: "forbidden" },
    {
      error: { kind: "InsufficientScope", message: "x", scope: "reports:write" },
      status: 403,
      code: "forbidden",
    },
    { error: { kind: "NotFound", message: "x" }, status: 404, code: "not_found" },
    {
      error: { kind: "UnsupportedMediaType", message: "x" },
      status: 415,
      code: "unsupported_media_type",
    },
    { error: { kind: "PayloadTooLarge", message: "x" }, status: 413, code: "payload_too_large" },
    { error: { kind: "ValidationError", message: "x" }, status: 422, code: "validation_error" },
    {
      error: { kind: "IdempotencyKeyReuseDifferentBody", message: "x" },
      status: 422,
      code: "idempotency_key_reuse",
    },
    {
      error: { kind: "IdempotencyInFlight", message: "x" },
      status: 409,
      code: "idempotency_in_flight",
    },
    {
      error: { kind: "PlanLimitExceeded", message: "x" },
      status: 402,
      code: "plan_limit_exceeded",
    },
    { error: { kind: "RateLimited", message: "x" }, status: 429, code: "rate_limited" },
    { error: { kind: "Unexpected", message: "x" }, status: 500, code: "internal_error" },
  ];

  it.each(CASES)("maps $error.kind → $status ($code)", ({ error, status, code }) => {
    const res = uploadResultToHttp(err(error), OPTS);
    expect(res.status).toBe(status);
    expect(res.contentType).toBe("application/problem+json");
    expect(res.body).toMatchObject({ type: "about:blank", status, code });
  });

  // A 500 must NOT echo the raw internal error message — adapters embed infra
  // detail (R2 response bodies, DB driver text) in Unexpected.message. Domain 4xx
  // messages are author-controlled and safe, so they DO pass through (see the
  // ValidationError test above).
  it("does not leak the raw internal message on a 500 Unexpected", () => {
    const res = uploadResultToHttp(
      err({ kind: "Unexpected", message: "R2 put failed (503): <secret bucket internals>" }),
      OPTS,
    );

    expect(res.status).toBe(500);
    const body = res.body as { detail: string };
    expect(body.detail).not.toContain("R2 put failed");
    expect(body.detail).not.toContain("secret bucket internals");
    expect(body.detail.length).toBeGreaterThan(0);
  });
});
