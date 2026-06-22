// Clerk-specific OAuth glue for the MCP resource server (ADR-0051, PR 4):
//   - verifyOAuthUser: validate an inbound Clerk OAuth access token → user id. The
//     verified token is then forwarded as-is to `/api/v1` (which re-verifies it) —
//     we do NOT exchange it for a Clerk session token, because Clerk's create-session
//     Backend API is testing-only / unavailable on a production instance (ADR-0051
//     amendment). Forwarding the same token to our own API is Clerk's supported
//     multi-backend pattern, mirroring the `arp_` key single-vendor forward.
//   - protectedResourceMetadata / clerkAuthServerOrigin: the RFC 9728 document
//     pointing MCP clients at Clerk as the authorization server.
import { createClerkClient } from "@clerk/backend";

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
