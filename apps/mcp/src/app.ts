// Express app for the remote MCP server (ADR-0051). Stateless Streamable HTTP:
// a fresh McpServer + transport per POST /mcp (SDK >=1.26 forbids reuse), bound
// to an ApiClient that forwards the request's `Authorization` to `/api/v1`
// (ADR-003, ADR-0008). Deployed as a Vercel Node serverless function via
// `api/index.ts`; runnable locally via `src/local.ts`.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { ApiClient } from "./client";
import { loadEnv } from "./env";
import { buildMcpServer } from "./server";

export function createApp() {
  const env = loadEnv();
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/mcp", async (req, res) => {
    const client = new ApiClient({
      baseUrl: env.APP_ORIGIN,
      authorization: req.header("authorization") ?? null,
    });
    const server = buildMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless (ADR-0051) — no sessions, serverless-safe
      enableJsonResponse: true, // request/response JSON, no long-lived SSE
    });
    // Tear down per-request resources when the client disconnects.
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
