import type { LoaderFunctionArgs } from "@remix-run/node";
import { viewHeaders } from "arp-headers/view";

export async function loader(_args: LoaderFunctionArgs) {
  const headers = viewHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  // /health is a status endpoint, so override the viewer's default
  // `Cache-Control: private, max-age=60` with no-store.
  headers.set("cache-control", "no-store");

  return new Response(
    JSON.stringify({
      status: "ok",
      service: "view",
      phase: "0c",
      checks: {
        process: "ok",
        edge_middleware: "wired",
        r2: "not-wired",
      },
      timestamp: new Date().toISOString(),
    }),
    { headers },
  );
}
