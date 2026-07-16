// Builds the MCP server for one request (ADR-0051). Stateless Streamable HTTP
// requires a fresh McpServer + transport per request (SDK >=1.26), so this is
// called from the Express handler with a client bound to that request's auth.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./client";
import { INSTRUCTIONS } from "./instructions";
import { registerReadTools, registerWriteTools } from "./tools";

export function buildMcpServer(client: ApiClient): McpServer {
  const server = new McpServer(
    { name: "arp-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  registerReadTools(server, client);
  registerWriteTools(server, client);
  return server;
}
