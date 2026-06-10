// HTTP response mapper for POST /api/v1/reports (ADR-0040). Pure: turns the
// use-case Result into a wire response — 201 JSON on success, RFC 9457
// application/problem+json on error. The mapping lives ONLY here (the adapter
// boundary); the domain/application keep returning Result<T, AppError> (ADR-0024).
import type { UploadOutcome } from "arp-application";
import type { AppError, Result } from "arp-domain";

export interface HttpResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface UploadResponseOptions {
  /** Origin the viewer is served from, e.g. "https://app.example" (no trailing slash). */
  readonly viewBaseUrl: string;
}

export function uploadResultToHttp(
  result: Result<UploadOutcome, AppError>,
  opts: UploadResponseOptions,
): HttpResponse {
  if (result.ok) {
    const { slug, version, scanStatus } = result.value.result;
    const viewUrl = `${opts.viewBaseUrl}/r/${slug}`;
    return {
      status: 201,
      contentType: "application/json",
      body: { slug, view_url: viewUrl, version, scan_status: scanStatus },
      headers: { Location: viewUrl },
    };
  }

  const p = problemFor(result.error);
  // Domain 4xx messages are author-controlled and safe to surface. Unexpected
  // (500) carries raw infrastructure detail (R2 bodies, DB driver text) from the
  // adapters — never echo it to the client; log it server-side instead.
  const detail =
    result.error.kind === "Unexpected" ? "An unexpected error occurred." : result.error.message;
  return {
    status: p.status,
    contentType: "application/problem+json",
    body: {
      type: "about:blank",
      title: p.title,
      status: p.status,
      detail,
      code: p.code,
    },
  };
}

interface ProblemSpec {
  readonly status: number;
  readonly code: string;
  readonly title: string;
}

// AppError.kind → RFC 9457 status/code/title (ADR-0040 + the openapi `code` registry).
function problemFor(error: AppError): ProblemSpec {
  switch (error.kind) {
    case "Unauthenticated":
      return { status: 401, code: "unauthenticated", title: "Unauthenticated" };
    case "NotAllowed":
    case "InsufficientScope":
      return { status: 403, code: "forbidden", title: "Forbidden" };
    case "NotFound":
      return { status: 404, code: "not_found", title: "Not found" };
    case "UnsupportedMediaType":
      return { status: 415, code: "unsupported_media_type", title: "Unsupported media type" };
    case "PayloadTooLarge":
      return { status: 413, code: "payload_too_large", title: "Payload too large" };
    case "ValidationError":
      return { status: 422, code: "validation_error", title: "Validation error" };
    case "IdempotencyKeyReuseDifferentBody":
      return { status: 422, code: "idempotency_key_reuse", title: "Idempotency key reused" };
    case "IdempotencyInFlight":
      return { status: 409, code: "idempotency_in_flight", title: "Request in flight" };
    case "PlanLimitExceeded":
      return { status: 402, code: "plan_limit_exceeded", title: "Plan limit exceeded" };
    case "RateLimited":
      return { status: 429, code: "rate_limited", title: "Rate limited" };
    case "Unexpected":
      return { status: 500, code: "internal_error", title: "Internal server error" };
    // No `default`: when a new AppError kind is added (ADR-0040 plans TooManyFiles
    // + DecompressionBomb → 413), TypeScript fails the typecheck gate here until
    // it's mapped — instead of silently returning 500 at runtime.
  }
}
