// Grantee read token — the app↔view READ capability for a write-grantee
// (ADR-0091). The third member of the ADR-0056 HMAC-compact family, beside the
// `Access token` (access-token.ts) and the `Edit token` (edit-token.ts): same
// wire format, same shared secret, same constant-time verify, built on the same
// claims-codec factory (claims-codec.ts over signed-token.ts, ADR-0073).
//
// WHY IT EXISTS. ADR-0089's owner view frames the canonical `GET /<slug>` in a
// sandboxed iframe. That framed navigation is a real same-site request, so it
// carries the path-scoped `arp_unlock` cookie and nothing else. An OWNER gets
// that cookie because the app mints them an `owner: true` Access token (`oa`)
// which the viewer redeems. A WRITE-GRANTEE — a canWrite non-owner, ADR-0060 —
// is deliberately never minted one: an `owner: true` claim for a non-owner is
// the privilege escalation ADR-0063 review #146 caught, because that claim
// bypasses EVERY share gate on the report and asserts something false about the
// principal. So the grantee used to get first-party chrome wrapped around the
// unlock wall (ADR-0089 §8). This token is the door that record named.
//
// WHAT MAKES IT SAFE. Two things, and the first is structural:
//
//   1. There is no `owner` field and no `mode` field in this shape. The claim
//      that would be an escalation is UNREPRESENTABLE here, not merely unset —
//      no code path can set it, so no code path can be audited into trusting it.
//
//   2. `scope: "granteeRead"` is the single-purpose discriminant, exactly as
//      `scope: "edit"` is for the Edit token. It is the security boundary
//      between three token types sharing one secret: an `AccessClaims` payload
//      (even an `owner: true` one) has neither `scope` nor `sub`, so it can
//      never narrow into these claims; and since ADR-0091 `parseAccessClaims`
//      REJECTS any payload carrying a `scope`, these claims can never narrow
//      into an `Access token` either. The separation is structural in both
//      directions rather than merely true in effect.
//
// It grants exactly one thing: mode-independent READ of the one report it is
// bound to, via `resolveAccessDecision`'s own branch. It is not accepted by
// `resolveEditTokenActor` (that parses `EditClaims`), so it is not a front door
// on the app's write API, and it confers no write anywhere.
//
// TTL belongs at the mint site, not here (this module stays pure and env-free).
// ADR-0091 §4 sets it to the Edit token's own 15 minutes — deliberately NOT the
// owner token's 24h, because ownership cannot be revoked and a write grant can.
import { makeClaimsCodec } from "./claims-codec";
import type { TokenClaims } from "./signed-token";

export interface GranteeReadClaims extends TokenClaims {
  /** SINGLE-REPORT binding — the report this read capability was minted for. */
  readonly slug: string;
  /** epoch seconds — SHORT-LIVED (see the module doc; 15 min at the mint site). */
  readonly exp: number;
  /** The acting user (UserId string) this read capability is for. Required +
   *  non-empty: a capability with no bound subject is not a capability, and the
   *  requirement is also part of what makes this shape non-narrowable from an
   *  `AccessClaims` payload, which has no `sub` at all. The view origin does not
   *  resolve it against anything — it is credential-free and verifies signatures
   *  only (ADR-0056's keystone) — so this is carried for audit and for the
   *  cross-parse boundary, never as an input to an authorization decision. */
  readonly sub: string;
  /** SINGLE-PURPOSE discriminant. Must be the exact literal `"granteeRead"`;
   *  any other value, including a merely-truthy string, is rejected. */
  readonly scope: "granteeRead";
}

/** Narrow a parsed JSON payload into `GranteeReadClaims`, or null if it doesn't
 *  look like one. THIS NARROW IS THE SECURITY BOUNDARY (see the module doc):
 *  strict on `scope` being exactly `"granteeRead"` and on `sub` being a
 *  non-empty string, which together make an `AccessClaims` — including an
 *  `owner: true` one signed with the same secret — unable to narrow here.
 *  Returns only the known vocabulary; anything else on the raw payload is
 *  dropped, never forwarded. In particular an `owner` key on the wire is
 *  dropped rather than carried, so even a hand-rolled payload cannot smuggle
 *  one through to a caller. */
function parseGranteeReadClaims(raw: unknown): GranteeReadClaims | null {
  if (typeof raw !== "object" || raw === null) return null;
  const claims = raw as Partial<GranteeReadClaims>;
  if (typeof claims.slug !== "string" || typeof claims.exp !== "number") return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  if (claims.scope !== "granteeRead") return null;
  return { slug: claims.slug, exp: claims.exp, sub: claims.sub, scope: "granteeRead" };
}

const codec = makeClaimsCodec({ parseClaims: parseGranteeReadClaims });

/** Mint a slug-bound, sub-bound grantee read token valid for `ttlSeconds` from
 *  `nowSeconds`. Construction key order (slug, exp, sub, scope) becomes part of
 *  the wire format per signed-token.ts's `mintClaimsToken` — JSON-encoded
 *  verbatim, then signed.
 *
 *  The ONE call site is the app's one mint, `GET /reports/{slug}/open`
 *  (open-report.server.ts), in the same `isOwner` ternary that decides the
 *  owner's `oa=` — so a principal receives this OR an owner Access token, never
 *  both, and never this if they are the owner (ADR-0091 §2). Adding a second
 *  mint site would reopen the owner/non-owner split this record exists to
 *  settle in one place. */
export function mintGranteeReadToken(
  slug: string,
  sub: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number,
): string {
  return codec.mint({ slug, exp: nowSeconds + ttlSeconds, sub, scope: "granteeRead" }, secret);
}

/** Verify + return the claims, or null if the signature is invalid, it has
 *  expired, it was minted for a different slug, or it doesn't narrow to
 *  `GranteeReadClaims` (wrong/missing `scope`, missing/empty `sub` — including
 *  any Access or Edit token that happens to share the signing secret).
 *  Constant-time compare (inherited from the codec); never throws. */
export function readGranteeReadToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): GranteeReadClaims | null {
  return codec.read(token, expectedSlug, secret, nowSeconds);
}
