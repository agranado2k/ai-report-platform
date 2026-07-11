// Edit token — the app↔view in-viewer-editing capability (ADR-0063). A compact,
// HMAC-signed, slug-bound (single-report), scope-bound (single-purpose), exp-bounded
// (short-lived) token: the app mints it for a `canWrite` user opening the editor on
// `view.<domain>/<slug>/edit`; the viewer's edit route verifies the signature + scope
// only (never holds Clerk creds; `canWrite` is re-checked server-side on every save,
// ADR-0063 §3/§5). Built on the shared signed-token codec (signed-token.ts), the same
// family as the `Access token` (access-token.ts) — same wire format, same constant-time
// verify. Suggested default TTL: 15-30 minutes (shorter than the 24h owner-access
// `Access token` — an edit capability is higher-privilege than read, so it should live
// a fraction as long); the exact constant belongs at the mint site (app-side, a later
// phase), not here — this module stays pure and env-free.
import { mintClaimsToken, readClaimsToken, type TokenClaims } from "./signed-token";

export interface EditClaims extends TokenClaims {
  /** SINGLE-REPORT binding — the report this capability was minted for. */
  readonly slug: string;
  /** epoch seconds — SHORT-LIVED (see module doc for the suggested TTL). */
  readonly exp: number;
  /** The acting user (UserId string) this edit capability is for — who's editing,
   *  not who granted it. Required + non-empty: an edit token with no bound subject
   *  is not a valid capability. */
  readonly sub: string;
  /** SINGLE-PURPOSE discriminant. This is the security boundary that prevents token
   *  confusion: an `Access token` (read/share capability, access-token.ts) is a
   *  structurally different, unrelated shape with no `scope`/`sub` fields, so it can
   *  never narrow into `EditClaims` even though both are minted under the same HMAC
   *  secret and codec family. Must be the exact literal `"edit"` — any other value
   *  (including a merely-truthy string) is rejected. */
  readonly scope: "edit";
  /** epoch seconds — the time of the FIRST mint of this refresh chain, carried
   *  forward UNCHANGED across every re-mint (edit-token-refresh.server.ts never
   *  resets it). This is the anchor the absolute session cap
   *  (`SESSION_CAP_SECONDS`, edit-token-refresh.server.ts) measures against:
   *  `now - sessionStart >= SESSION_CAP_SECONDS` bounds the TOTAL length of a
   *  refresh chain independent of write-grant revocation, so a leaked token
   *  dies eventually even against a grant that's never revoked (e.g. an
   *  owner's own report). OPTIONAL for backward compat: a token minted before
   *  this field existed has none — it still authenticates normally here
   *  (`readEditToken`/`parseEditClaims` don't require it for save/comments/
   *  diff), only the refresh path treats a missing `sessionStart` specially
   *  (fail closed — see refreshEditToken's module doc). */
  readonly sessionStart?: number;
}

/** Narrow a parsed JSON payload into `EditClaims`, or null if it doesn't look like
 *  one. This narrow IS the security boundary: it's what stops an `AccessClaims`
 *  token (even an `owner:true` one, signed with the same shared secret) from being
 *  read as an edit capability — token confusion between the read/share primitive
 *  and the edit primitive. Strict on purpose: `slug` a string, `exp` a number,
 *  `sub` a NON-EMPTY string, and `scope === "edit"` EXACTLY (no other/missing
 *  scope narrows); `sessionStart`, if present, must be a number (type confusion
 *  guard) — but its ABSENCE is not rejected: a pre-session-cap legacy token has
 *  none and still narrows fine (backward compat, see `EditClaims.sessionStart`'s
 *  doc). Returns only those known fields — anything else on the raw payload is
 *  dropped, not forwarded. */
function parseEditClaims(raw: unknown): EditClaims | null {
  if (typeof raw !== "object" || raw === null) return null;
  const claims = raw as Partial<EditClaims>;
  if (typeof claims.slug !== "string" || typeof claims.exp !== "number") return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  if (claims.scope !== "edit") return null;
  if (claims.sessionStart !== undefined && typeof claims.sessionStart !== "number") return null;
  return {
    slug: claims.slug,
    exp: claims.exp,
    sub: claims.sub,
    scope: "edit",
    ...(claims.sessionStart !== undefined ? { sessionStart: claims.sessionStart } : {}),
  };
}

/** Mint a slug-bound, sub-bound edit token valid for `ttlSeconds` from `nowSeconds`.
 *  Construction key order (slug, exp, sub, scope, sessionStart) becomes part of
 *  the wire format per signed-token.ts's `mintClaimsToken` — JSON-encoded
 *  verbatim, then signed. `sessionStartSeconds` defaults to `nowSeconds` — a
 *  FRESH session — so every EXISTING mint site (open-report.server.ts's first
 *  mint on `/open`) is unchanged: it always starts a new session. Only a
 *  REFRESH (edit-token-refresh.server.ts) passes an explicit value — the
 *  ORIGINAL session's start, carried forward unchanged — so a chain of
 *  refreshes all measure against the same anchor for the absolute session cap. */
export function mintEditToken(
  slug: string,
  sub: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number,
  sessionStartSeconds: number = nowSeconds,
): string {
  const claims: EditClaims = {
    slug,
    exp: nowSeconds + ttlSeconds,
    sub,
    scope: "edit",
    sessionStart: sessionStartSeconds,
  };
  return mintClaimsToken(claims, secret);
}

/** Verify + return the claims, or null if the signature is invalid, it has expired,
 *  it was minted for a different slug, or it doesn't narrow to `EditClaims` (wrong/
 *  missing `scope`, missing `sub` — including any non-edit token, like an `Access
 *  token`, that happens to share the signing secret). Constant-time compare
 *  (inherited from the codec); never throws. */
export function readEditToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): EditClaims | null {
  const claims = readClaimsToken(token, secret, nowSeconds, parseEditClaims);
  if (!claims) return null;
  return claims.slug === expectedSlug ? claims : null;
}

/** True iff the token's signature is valid, it hasn't expired, it was minted for
 *  `expectedSlug`, and it narrows to a genuine edit-scoped capability. Thin boolean
 *  wrapper over `readEditToken`. */
export function verifyEditToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): boolean {
  return readEditToken(token, expectedSlug, secret, nowSeconds) !== null;
}
