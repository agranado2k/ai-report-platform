// Minimal env contract for the MCP server (ADR-0043 spirit — validate at the
// boundary). Deliberately NOT `arp-env`: that schema is the app's DB/R2/Clerk
// contract, which the MCP server (a thin HTTP client over `/api/v1`, ADR-003)
// has no business holding. All the MCP needs is where the API lives.
import { z } from "zod";

const schema = z.object({
  /** Origin of the report platform API, e.g. https://app.agranado.com (ADR-003). */
  APP_ORIGIN: z.url(),
  /** Local dev port (ignored on Vercel, which routes via the serverless function). */
  PORT: z.coerce.number().int().positive().default(8787),
  // OAuth 2.1 resource-server credentials (ADR-0051, PR 4). Clerk is the auth
  // server; the MCP needs its secret to (a) verify inbound OAuth access tokens
  // and (b) mint a short-lived session token for the verified user to call
  // `/api/v1`. OPTIONAL + fail-closed: with these unset, the OAuth path is simply
  // disabled (returns 401) — the `arp_` API-key passthrough still works. This is
  // the MCP's first secret; keep it scoped to OAuth.
  CLERK_SECRET_KEY: z.string().trim().min(1).optional(),
  PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
  // Canonical public origin of THIS MCP server, e.g. https://mcp.agranado.com.
  // Used as the fixed OAuth resource identifier (RFC 9728 metadata + the token
  // audience we verify against) instead of the client-controlled Host header.
  // Optional: in local dev / previews (no stable origin) we fall back to Host.
  MCP_ORIGIN: z.url().optional(),
});

export type McpEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  return schema.parse({
    APP_ORIGIN: source.APP_ORIGIN,
    PORT: source.PORT,
    CLERK_SECRET_KEY: source.CLERK_SECRET_KEY,
    PUBLIC_CLERK_PUBLISHABLE_KEY: source.PUBLIC_CLERK_PUBLISHABLE_KEY,
    MCP_ORIGIN: source.MCP_ORIGIN,
  });
}
