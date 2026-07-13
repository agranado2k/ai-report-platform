// AppError — the domain's failure vocabulary. The HTTP adapter maps each kind
// to a status code + problem+json body in exactly one place (ADR-0040); the
// domain stays transport-agnostic.

export type AppError =
  | { readonly kind: "Unauthenticated"; readonly message: string }
  | { readonly kind: "NotAllowed"; readonly message: string }
  | { readonly kind: "InsufficientScope"; readonly message: string; readonly scope: string }
  | { readonly kind: "NotFound"; readonly message: string }
  | { readonly kind: "Conflict"; readonly message: string }
  | { readonly kind: "UnsupportedMediaType"; readonly message: string }
  | { readonly kind: "PayloadTooLarge"; readonly message: string }
  | { readonly kind: "ValidationError"; readonly message: string; readonly field?: string }
  | { readonly kind: "IdempotencyKeyReuseDifferentBody"; readonly message: string }
  | { readonly kind: "IdempotencyInFlight"; readonly message: string }
  | { readonly kind: "PlanLimitExceeded"; readonly message: string }
  | { readonly kind: "RateLimited"; readonly message: string }
  | { readonly kind: "MethodNotAllowed"; readonly message: string; readonly allow: string }
  | { readonly kind: "Unexpected"; readonly message: string };

export const validationError = (message: string, field?: string): AppError =>
  field === undefined
    ? { kind: "ValidationError", message }
    : { kind: "ValidationError", message, field };

export const notFound = (message = "not found"): AppError => ({ kind: "NotFound", message });
/** A concurrent-modification conflict (maps to HTTP 409, ADR-0040). Raised when a
 *  client edits a resource against a stale version — e.g. the comment's
 *  optimistic-concurrency token no longer matches the stored value. */
export const conflict = (message = "conflict"): AppError => ({ kind: "Conflict", message });
export const notAllowed = (message = "not allowed"): AppError => ({ kind: "NotAllowed", message });
export const insufficientScope = (scope: string): AppError => ({
  kind: "InsufficientScope",
  message: `missing required scope: ${scope}`,
  scope,
});

/** The one 405 wire shape (ADR-0040): `allow` is the comma-joined method list
 *  rendered on the response's `Allow` header (e.g. "PATCH, DELETE"). */
export const methodNotAllowed = (allow: string, message?: string): AppError => ({
  kind: "MethodNotAllowed",
  message: message ?? `allowed methods: ${allow}`,
  allow,
});
