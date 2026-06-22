// Local dev entry: run the MCP server on a port for the MCP Inspector / curl.
// `APP_ORIGIN` must point at a running API (e.g. a preview or prod). Vercel uses
// the bundled `api/index.mjs` instead, so this is dev-only.
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
createApp().listen(port, () => {
  console.log(`arp-mcp listening on http://localhost:${port}/mcp`);
});
