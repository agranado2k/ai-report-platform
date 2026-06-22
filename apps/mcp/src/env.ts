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
});

export type McpEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  return schema.parse({ APP_ORIGIN: source.APP_ORIGIN, PORT: source.PORT });
}
