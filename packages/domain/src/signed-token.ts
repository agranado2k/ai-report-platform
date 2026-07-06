// Signed-token codec (ADR-0056) — the shared HMAC-SHA256 compact-token
// primitive underlying both the Access token (access-token.ts) and the
// Magic-link token (magic-link.ts). Wire format: base64url(payload) + "." +
// HMAC-SHA256(payload, secret) (base64url digest), verified with a
// timing-safe compare. Owns payload encode/decode, sign, verify, and (for
// claims-carrying tokens) expiry — each token type supplies its own claims
// shape/validation on top. Extracted from two independently hand-rolled
// implementations to guarantee identical wire format + constant-time verify
// (gather-the-sharing-concept refactor). Pure computation, like the base62
// external-id codec — no I/O, `nowSeconds` is injected for testability.
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of `payload` under `secret`, base64url-encoded. */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Split a compact `payload.signature` token on its first dot. Null if
 *  malformed (no dot, or an empty payload segment). */
function splitToken(token: string): { readonly payload: string; readonly sig: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  return { payload: token.slice(0, dot), sig: token.slice(dot + 1) };
}

/** Constant-time signature check. Compares lengths first (this leaks the
 *  digest length, which is fixed and public — HMAC-SHA256/base64url is
 *  always the same length) before the timing-safe byte compare. */
function signatureValid(payload: string, sig: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

/** Mint a compact signed token carrying `rawPayload` verbatim (base64url-encoded,
 *  then signed). `rawPayload` is whatever bytes the caller wants on the wire — a
 *  JSON claims string (`mintClaimsToken`) or a bare id (the magic-link nonce). */
export function mintSignedToken(rawPayload: string, secret: string): string {
  const payload = Buffer.from(rawPayload, "utf8").toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

/** Verify a compact signed token's signature and return its decoded raw payload
 *  (the exact string passed to `mintSignedToken`), or null if malformed, forged,
 *  or tampered. Does NOT interpret the payload (no JSON parsing, no expiry) —
 *  that's the caller's concern. Never throws. */
export function readSignedTokenPayload(token: string, secret: string): string | null {
  const split = splitToken(token);
  if (!split) return null;
  if (!signatureValid(split.payload, split.sig, secret)) return null;
  try {
    return Buffer.from(split.payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** The minimum shape every claims-carrying token must have: an expiry (epoch
 *  seconds) the codec checks generically, on top of whatever fields the caller's
 *  own claims type adds. */
export interface TokenClaims {
  readonly exp: number;
}

/** Mint a claims-carrying signed token: JSON-encode `claims` (in whatever key
 *  order the caller constructs it — that order becomes part of the wire format),
 *  then sign it like any other signed token. */
export function mintClaimsToken<C extends TokenClaims>(claims: C, secret: string): string {
  return mintSignedToken(JSON.stringify(claims), secret);
}

/** Verify a claims-carrying token: check the signature (before touching the
 *  payload, so a forged token never reaches JSON.parse), parse its JSON payload,
 *  narrow it via the caller-supplied `parseClaims` (the codec doesn't know any one
 *  token's field vocabulary), then check `exp` against `nowSeconds`. Null if the
 *  signature is invalid, the payload isn't valid JSON, `parseClaims` rejects the
 *  shape, or the token has expired. */
export function readClaimsToken<C extends TokenClaims>(
  token: string,
  secret: string,
  nowSeconds: number,
  parseClaims: (raw: unknown) => C | null,
): C | null {
  const rawPayload = readSignedTokenPayload(token, secret);
  if (rawPayload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  const claims = parseClaims(parsed);
  if (!claims) return null;
  if (claims.exp <= nowSeconds) return null;
  return claims;
}
