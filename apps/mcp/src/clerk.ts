// Clerk-specific OAuth glue for the MCP resource server (ADR-0051, PR 4):
//   - mintSessionToken: exchange an OAuth-verified user for a short-lived Clerk
//     session token (a JWT `/api/v1` already accepts) — so we never forward the
//     inbound OAuth token (MCP spec: no token passthrough). Mirrors the backend
//     recipe in tests/e2e/support/clerk-session.ts.
//   - verifyOAuthUser: validate an inbound Clerk OAuth access token → user id.
//   - protectedResourceMetadata / clerkAuthServerOrigin: the RFC 9728 document
//     pointing MCP clients at Clerk as the authorization server.
import { createClerkClient } from "@clerk/backend";

const CLERK_API = "https://api.clerk.com/v1";

export interface ClerkConfig {
  readonly secretKey: string;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export async function mintSessionToken(userId: string, cfg: ClerkConfig): Promise<string> {
  const f = cfg.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${cfg.secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const sessionRes = await f(`${CLERK_API}/sessions`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ user_id: userId }),
  });
  if (!sessionRes.ok) throw new Error(`clerk createSession failed: ${sessionRes.status}`);
  const sessionId = ((await sessionRes.json()) as { id: string }).id;

  const tokenRes = await f(`${CLERK_API}/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ expires_in_seconds: "600" }),
  });
  if (!tokenRes.ok) throw new Error(`clerk session token failed: ${tokenRes.status}`);
  return ((await tokenRes.json()) as { jwt: string }).jwt;
}

/**
 * Derive the Clerk authorization-server origin from a publishable key. A Clerk pk
 * is `pk_(test|live)_<base64(frontendApiHost + "$")>`; the AS issuer is
 * `https://<frontendApiHost>`, which serves `/.well-known/oauth-authorization-server`.
 */
export function clerkAuthServerOrigin(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  const host = atob(encoded).replace(/\$+$/, "");
  return `https://${host}`;
}

/** RFC 9728 protected-resource metadata: this MCP resource + its Clerk auth server. */
export function protectedResourceMetadata(
  resourceUrl: string,
  publishableKey: string,
): Record<string, unknown> {
  return {
    resource: resourceUrl,
    authorization_servers: [clerkAuthServerOrigin(publishableKey)],
    bearer_methods_supported: ["header"],
  };
}

export interface OAuthVerifyConfig {
  readonly secretKey: string;
  readonly publishableKey?: string;
}

/**
 * Verify an inbound `Authorization` header as a Clerk OAuth access token and
 * return the subject Clerk user id, or null. Thin wrapper over `@clerk/backend`;
 * fail-closed (any error → null). NOTE: exercised live against the operator's
 * Clerk OAuth application — the unit suite covers the surrounding logic, not this
 * network call.
 */
export async function verifyOAuthUser(
  authorization: string,
  cfg: OAuthVerifyConfig,
  resourceUrl: string,
): Promise<string | null> {
  try {
    const clerk = createClerkClient({
      secretKey: cfg.secretKey,
      publishableKey: cfg.publishableKey,
    });
    // Build the Request against the REAL resource URL so any resource/audience
    // (RFC 8707) check validates against this server's canonical identity rather
    // than a sentinel host (PR #91 review finding #1).
    const request = new Request(resourceUrl, { headers: { authorization } });
    const state = await clerk.authenticateRequest(request, { acceptsToken: "oauth_token" });
    const auth = state.toAuth();
    if (auth && "userId" in auth && typeof auth.userId === "string") return auth.userId;
    return null;
  } catch {
    return null;
  }
}
