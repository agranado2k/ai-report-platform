// AppError — the domain's failure vocabulary. The HTTP adapter maps each kind
// to a status code + problem+json body in exactly one place (ADR-0040); the
// domain stays transport-agnostic.

export type AppError =
  | { readonly kind: "Unauthenticated"; readonly message: string }
  | { readonly kind: "NotAllowed"; readonly message: string }
  | { readonly kind: "InsufficientScope"; readonly message: string; readonly scope: string }
  | { readonly kind: "NotFound"; readonly message: string }
  | { readonly kind: "UnsupportedMediaType"; readonly message: string }
  | { readonly kind: "PayloadTooLarge"; readonly message: string }
  | { readonly kind: "ValidationError"; readonly message: string; readonly field?: string }
  | { readonly kind: "IdempotencyKeyReuseDifferentBody"; readonly message: string }
  | { readonly kind: "IdempotencyInFlight"; readonly message: string }
  | { readonly kind: "PlanLimitExceeded"; readonly message: string }
  | { readonly kind: "RateLimited"; readonly message: string }
  | { readonly kind: "Unexpected"; readonly message: string };

export const validationError = (message: string, field?: string): AppError =>
  field === undefined
    ? { kind: "ValidationError", message }
    : { kind: "ValidationError", message, field };

export const notFound = (message = "not found"): AppError => ({ kind: "NotFound", message });
export const notAllowed = (message = "not allowed"): AppError => ({ kind: "NotAllowed", message });
export const insufficientScope = (scope: string): AppError => ({
  kind: "InsufficientScope",
  message: `missing required scope: ${scope}`,
  scope,
});
