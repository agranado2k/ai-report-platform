// The MCP server's endpoint, derived from the app origin (ADR-0051). The MCP
// server lives at `mcp.<apex>`, a sibling of this app at `app.<apex>`, so the
// endpoint is a host swap plus `/mcp`. Pure over the origin string so it is
// unit-testable and shared by every surface that shows the endpoint (the API-keys
// settings route and the ⌘K palette's "Copy MCP endpoint" action).
//
// The `app.` → `mcp.` swap is a no-op on any other host (a preview `*.vercel.app`
// shows the preview host; an apex/custom APP_ORIGIN would want MCP_ORIGIN wired).
export function mcpEndpointFrom(origin: string): string {
  const url = new URL(origin);
  url.host = url.host.replace(/^app\./, "mcp.");
  url.pathname = "/mcp";
  url.search = "";
  return url.toString();
}
