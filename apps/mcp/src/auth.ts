// Resolve the credential the MCP forwards to `/api/v1` for an inbound request
// (ADR-0051). Two front doors:
//   - `Bearer arp_…` API key (ADR-0008) → forwarded verbatim (headless agents).
//   - a Clerk OAuth access token (interactive clients) → verified as belonging to a
//     user, then FORWARDED as-is to `/api/v1`, which re-verifies the same token
//     (`acceptsToken: 'oauth_token'`). We do NOT mint a Clerk session token to
//     forward instead: Clerk's create-session Backend API is testing-only and
//     unavailable on a production instance (ADR-0051 amendment). Verifying the same
//     token at both our own services is Clerk's supported pattern — a deliberate
//     single-vendor forward, like the `arp_` key path.
// Returns null when there's no usable credential — the caller then replies 401 +
// WWW-Authenticate to kick off OAuth discovery.

export interface DownstreamAuthDeps {
  /** Verify an inbound Authorization header as a Clerk OAuth token → Clerk user id, or null. */
  readonly verifyOAuthUser: (authorization: string) => Promise<string | null>;
}

export async function resolveDownstreamAuthorization(
  authorization: string | null,
  deps: DownstreamAuthDeps,
): Promise<string | null> {
  if (!authorization) return null;
  // Headless API-key path — forward the arp_ key as-is (its audience is the API).
  // Scheme is case-insensitive per HTTP (a `bearer arp_…` must still match).
  if (/^Bearer\s+arp_/i.test(authorization)) return authorization;
  // Interactive OAuth path — verify the token belongs to a user (resource-server
  // gate), then forward the SAME token; `/api/v1` re-verifies it as an oauth_token.
  const userId = await deps.verifyOAuthUser(authorization);
  if (!userId) return null;
  return authorization;
}
