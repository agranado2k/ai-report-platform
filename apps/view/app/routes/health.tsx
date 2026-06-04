import type { LoaderFunctionArgs } from "@remix-run/node";
import { viewHeaders } from "arp-headers/view";
import pkg from "../../package.json";

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
      version: pkg.version,
      // Vercel injects VERCEL_GIT_COMMIT_SHA at build + runtime; "dev" locally.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
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
