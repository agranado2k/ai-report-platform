// Express app for the remote MCP server (ADR-0051). Stateless Streamable HTTP:
// a fresh McpServer + transport per POST /mcp (SDK >=1.26 forbids reuse), bound
// to an ApiClient whose downstream credential is RESOLVED per request (ADR-0051
// PR 4): an `arp_` API key is forwarded as-is (headless, ADR-0008); a Clerk OAuth
// access token is verified and exchanged for a short-lived Clerk session token
// (never forwarded — no token passthrough). Bundled by esbuild + deployed as a
// Vercel Node serverless function via `api/index.mjs`; runnable via `src/local.ts`.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { resolveDownstreamAuthorization } from "./auth";
import { mintSessionToken, protectedResourceMetadata, verifyOAuthUser } from "./clerk";
import { ApiClient } from "./client";
import { loadEnv, type McpEnv } from "./env";
import { buildMcpServer } from "./server";

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
/** Reuse a minted session token for a user until shortly before it expires (the
 *  token is minted with a 600s lifetime) — avoids creating a fresh Clerk session
 *  on every interactive request (PR #91 review finding #3). Warm-instance scoped. */
const TOKEN_TTL_MS = 540_000;

/**
 * The OAuth dependencies the server needs when the Clerk-OAuth path is enabled.
 * Built from env for production (`buildClerkOAuth`); injected directly in tests so
 * the resource-server paths (metadata, 401/`WWW-Authenticate`, token cache, 502)
 * are exercisable without touching Clerk or the network.
 */
export interface OAuthDeps {
  /** Clerk publishable key — derives the auth-server origin for the RFC-9728 doc. */
  readonly publishableKey: string;
  /** Verify an inbound Authorization as a Clerk OAuth token → user id (or null). */
  readonly verifyUser: (authorization: string, resourceUrl: string) => Promise<string | null>;
  /** Mint a short-lived Clerk session token for a verified user. */
  readonly mintSessionToken: (userId: string) => Promise<string>;
}

/** Wire the real Clerk-backed OAuth deps from env, or null when keys are unset (fail-closed). */
function buildClerkOAuth(env: McpEnv): OAuthDeps | null {
  const secretKey = env.CLERK_SECRET_KEY;
  const publishableKey = env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) return null;
  return {
    publishableKey,
    verifyUser: (authorization, resourceUrl) =>
      verifyOAuthUser(authorization, { secretKey, publishableKey }, resourceUrl),
    mintSessionToken: (userId) => mintSessionToken(userId, { secretKey }),
  };
}

export function createApp(injectedOAuth?: OAuthDeps) {
  const env = loadEnv();
  const app = express();

  // Baseline hardening for the JSON endpoints (defence-in-depth — these emit only
  // JSON, no HTML/cookies, so this is lighter than the viewer's ADR-013 stack):
  // don't sniff content types, and don't cache API responses by default (the
  // public metadata doc opts back into caching below).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json());

  // OAuth 2.1 is enabled only when Clerk keys are configured (fail-closed): without
  // them the OAuth path stays off and only the `arp_` API-key path works. Tests
  // inject `injectedOAuth` to enable it with fakes.
  const oauth = injectedOAuth ?? buildClerkOAuth(env);

  // Canonical OAuth resource identifier — a CONFIGURED origin, never the
  // client-controlled Host header (PR #91 review finding #2). Falls back to Host
  // only in local dev / previews where no stable origin is set.
  const originOf = (req: express.Request) => env.MCP_ORIGIN ?? `https://${req.header("host")}`;

  // Per-user session-token cache (warm-instance scoped) to curb Clerk session churn.
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();
  const mintCached = async (userId: string): Promise<string> => {
    if (!oauth) throw new Error("OAuth is not configured on this MCP server");
    const now = Date.now();
    const hit = tokenCache.get(userId);
    if (hit && hit.expiresAt > now) return hit.token;
    // Prune expired entries on miss so the map stays bounded on a long-lived
    // warm instance (PR #91 re-review nit).
    for (const [key, value] of tokenCache) if (value.expiresAt <= now) tokenCache.delete(key);
    const token = await oauth.mintSessionToken(userId);
    tokenCache.set(userId, { token, expiresAt: now + TOKEN_TTL_MS });
    return token;
  };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // RFC 9728 protected-resource metadata — public + cacheable; points MCP clients
  // at Clerk as the authorization server. Only served when OAuth is configured.
  if (oauth) {
    app.get(PROTECTED_RESOURCE_METADATA_PATH, (req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300"); // override the global no-store
      res.json(protectedResourceMetadata(`${originOf(req)}/mcp`, oauth.publishableKey));
    });
  }

  app.post("/mcp", async (req, res) => {
    const origin = originOf(req);
    const resourceUrl = `${origin}/mcp`;

    let authorization: string | null;
    try {
      authorization = await resolveDownstreamAuthorization(req.header("authorization") ?? null, {
        verifyOAuthUser: oauth ? (h) => oauth.verifyUser(h, resourceUrl) : async () => null,
        mintSessionToken: mintCached,
      });
    } catch {
      // A verified user whose session-token mint failed (Clerk hiccup/rate-limit)
      // — surface a clean 502 rather than leaking a default 500 (review finding #4).
      res.status(502).json({ error: "auth backend unavailable; retry shortly" });
      return;
    }

    if (!authorization) {
      // Resource-server 401: advertise where to discover the auth server (RFC 9728)
      // so an OAuth-capable client can start the flow. Headless callers just send
      // a valid `arp_` key and never see this.
      if (oauth) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_METADATA_PATH}"`,
        );
      }
      res.status(401).json({ error: "unauthorized: present an API key or authenticate via OAuth" });
      return;
    }

    const client = new ApiClient({ baseUrl: env.APP_ORIGIN, authorization });
    const server = buildMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless (ADR-0051) — no sessions, serverless-safe
      enableJsonResponse: true, // request/response JSON, no long-lived SSE
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless mode is POST-driven; the GET/DELETE SSE+session endpoints don't apply.
  app.all("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed — use POST for the MCP endpoint" });
  });

  return app;
}
