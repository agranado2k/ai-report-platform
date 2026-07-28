// Result<T, E> — the domain's typed success/failure value (ADR-024, ADR-0073).
// No exceptions for expected failures; callers narrow on the `ok` discriminant.

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
