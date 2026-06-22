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
import { loadEnv } from "./env";
import { buildMcpServer } from "./server";

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

export function createApp() {
  const env = loadEnv();
  const app = express();

  // Baseline hardening for the JSON endpoints (defence-in-depth — these emit only
  // JSON, no HTML/cookies, so this is lighter than the viewer's ADR-013 stack):
  // don't sniff content types, and don't cache API responses.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json());

  // OAuth 2.1 is enabled only when Clerk keys are configured (fail-closed): without
  // them the OAuth path stays off and only the `arp_` API-key path works.
  const oauth =
    env.CLERK_SECRET_KEY && env.PUBLIC_CLERK_PUBLISHABLE_KEY
      ? { secretKey: env.CLERK_SECRET_KEY, publishableKey: env.PUBLIC_CLERK_PUBLISHABLE_KEY }
      : null;

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // RFC 9728 protected-resource metadata — public; points MCP clients at Clerk as
  // the authorization server. Only served when OAuth is configured.
  if (oauth) {
    app.get(PROTECTED_RESOURCE_METADATA_PATH, (req, res) => {
      res.json(
        protectedResourceMetadata(`https://${req.header("host")}/mcp`, oauth.publishableKey),
      );
    });
  }

  app.post("/mcp", async (req, res) => {
    const authorization = await resolveDownstreamAuthorization(
      req.header("authorization") ?? null,
      {
        verifyOAuthUser: oauth ? (h) => verifyOAuthUser(h, oauth) : async () => null,
        mintSessionToken: oauth
          ? (userId) => mintSessionToken(userId, { secretKey: oauth.secretKey })
          : async () => {
              throw new Error("OAuth is not configured on this MCP server");
            },
      },
    );

    if (!authorization) {
      // Resource-server 401: advertise where to discover the auth server (RFC 9728)
      // so an OAuth-capable client can start the flow. Headless callers just send
      // a valid `arp_` key and never see this.
      if (oauth) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="https://${req.header("host")}${PROTECTED_RESOURCE_METADATA_PATH}"`,
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
