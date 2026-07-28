// Shared HTTP-adapter primitives (ADR-0040): the wire-response shape and the
// pure AppError → RFC 9457 application/problem+json mapper. Extracted so every
// endpoint mapper (upload, list, move, …) renders errors identically; the
// domain/application keep returning Result<T, AppError> (ADR-0024).
import type { AppError } from "arp-domain";

export interface HttpResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/** Render an AppError as an application/problem+json HttpResponse. */
export function errorToHttp(error: AppError): HttpResponse {
  const p = problemFor(error);
  // Domain 4xx messages are author-controlled and safe to surface. Unexpected
  // (500) carries raw infrastructure detail (R2 bodies, DB driver text) from the
  // adapters — never echo it to the client; log it server-side instead.
  const detail = error.kind === "Unexpected" ? "An unexpected error occurred." : error.message;
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
    // The one 405 wire shape (ADR-0040) carries its Allow header here — the
    // single place that maps AppError → response, so every 405 site (API
    // routes + the webhook/scan-drain method guards) renders identically.
    ...(error.kind === "MethodNotAllowed" ? { headers: { Allow: error.allow } } : {}),
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
    case "Conflict":
      return { status: 409, code: "conflict", title: "Conflict" };
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
    case "MethodNotAllowed":
      return { status: 405, code: "method_not_allowed", title: "Method not allowed" };
    case "Unexpected":
      return { status: 500, code: "internal_error", title: "Internal server error" };
    // No `default`: when a new AppError kind is added (ADR-0040 plans TooManyFiles
    // + DecompressionBomb → 413), TypeScript fails the typecheck gate here until
    // it's mapped — instead of silently returning 500 at runtime.
  }
}
