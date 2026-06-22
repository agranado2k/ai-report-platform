// Resolve the credential the MCP forwards to `/api/v1` for an inbound request
// (ADR-0051). Two front doors:
//   - `Bearer arp_…` API key (ADR-0008) → forwarded verbatim (headless agents).
//   - a Clerk OAuth access token (interactive clients) → verified as belonging to
//     a user, then exchanged for a short-lived Clerk SESSION token minted for that
//     user. We forward the minted session token, NOT the OAuth token: the MCP spec
//     forbids passing the inbound token through to an upstream API, and `/api/v1`'s
//     existing Clerk-session path already accepts a session JWT.
// Returns null when there's no usable credential — the caller then replies 401 +
// WWW-Authenticate to kick off OAuth discovery.

export interface DownstreamAuthDeps {
  /** Verify an inbound Authorization header as a Clerk OAuth token → Clerk user id, or null. */
  readonly verifyOAuthUser: (authorization: string) => Promise<string | null>;
  /** Mint a short-lived Clerk session token (a JWT `/api/v1` accepts) for a user. */
  readonly mintSessionToken: (userId: string) => Promise<string>;
}

export async function resolveDownstreamAuthorization(
  authorization: string | null,
  deps: DownstreamAuthDeps,
): Promise<string | null> {
  if (!authorization) return null;
  // Headless API-key path — forward the arp_ key as-is (its audience is the API).
  if (/^Bearer\s+arp_/.test(authorization)) return authorization;
  // Interactive OAuth path — verify, then mint a separate session token.
  const userId = await deps.verifyOAuthUser(authorization);
  if (!userId) return null;
  return `Bearer ${await deps.mintSessionToken(userId)}`;
}
