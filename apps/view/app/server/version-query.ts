// parseVersionQuery — the pure ?v=N query-param parser behind $slug.tsx's
// version-by-ordinal resolution (issue #155, ADR-0038 §3). Strict: only a bare
// run of ASCII digits (no sign, decimal point, exponent, or surrounding
// whitespace) counts as a well-formed ordinal; anything else — missing, empty,
// or malformed — is treated as ABSENT, so the caller falls back to serving the
// live version (the pre-existing, unchanged default). This is a deliberate
// judgment call: the route had no ?v=N handling at all before this change, so
// there's no existing "malformed input" precedent to preserve, and quietly
// falling back to the safe default doesn't open a new oracle (unlike 404ing on
// malformed input, which would let a caller distinguish "the route parses v"
// from "it doesn't" one bit at a time).
//
// `0` and negative ordinals ARE well-formed integers by this parser and are
// passed through unchanged — resolveViewableReport's ?v=N resolver is what maps
// an out-of-range ordinal (including 0/negative) to `notfound`, so the
// reason-opaque 404 for "doesn't exist" lives in one place (ADR-0038 §2's
// "don't leak version count"), not duplicated at the parse layer.
const INTEGER_ONLY = /^\d+$/;

export function parseVersionQuery(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  if (!INTEGER_ONLY.test(raw)) return undefined;
  return Number(raw);
}
