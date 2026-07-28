// Claims-codec factory (ADR-0073) — the one shared shell behind the slug-bound
// capability tokens (access-token.ts, edit-token.ts). Both tokens are the same
// machine: JSON claims minted through signed-token.ts's `mintClaimsToken`, read
// back through `readClaimsToken` (signature → JSON → caller narrow → expiry),
// then checked against the expected slug. Only the claims vocabulary differs, so
// the factory takes exactly that — a `parseClaims` narrow — and returns the
// mint/read pair. Mint passes claims through verbatim (the caller's construction
// key order IS the wire format, per signed-token.ts); read fails closed to null,
// never throws, and inherits the codec's constant-time signature compare.
import { mintClaimsToken, readClaimsToken, type TokenClaims } from "./signed-token";

/** The minimum shape a factory-made token's claims must have: the generic expiry
 *  (`exp`, from `TokenClaims`) plus the slug binding the factory checks on read. */
export interface SlugBoundClaims extends TokenClaims {
  readonly slug: string;
}

export interface ClaimsCodec<C extends SlugBoundClaims> {
  /** Sign `claims` as a compact token. Claims go on the wire verbatim — the
   *  caller owns construction (TTL arithmetic, optional-field spreading, key order). */
  readonly mint: (claims: C, secret: string) => string;
  /** Verify + return the claims, or null if the signature is invalid, the payload
   *  doesn't narrow via `parseClaims`, it has expired, or it was minted for a
   *  different slug. Never throws. */
  readonly read: (
    token: string,
    expectedSlug: string,
    secret: string,
    nowSeconds: number,
  ) => C | null;
}

/** Build the mint/read pair for one claims vocabulary. `parseClaims` is the
 *  security boundary between token types sharing the same secret + wire format
 *  (e.g. AccessClaims vs EditClaims) — it must reject any shape that isn't
 *  exactly its own. */
export function makeClaimsCodec<C extends SlugBoundClaims>({
  parseClaims,
}: {
  readonly parseClaims: (raw: unknown) => C | null;
}): ClaimsCodec<C> {
  return {
    mint: (claims, secret) => mintClaimsToken(claims, secret),
    read: (token, expectedSlug, secret, nowSeconds) => {
      const claims = readClaimsToken(token, secret, nowSeconds, parseClaims);
      if (!claims) return null;
      return claims.slug === expectedSlug ? claims : null;
    },
  };
}
