import type { LoaderFunctionArgs } from "@remix-run/node";
import { appHeaders } from "arp-headers/app";

export async function loader(_args: LoaderFunctionArgs) {
  const headers = appHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(
    JSON.stringify({
      status: "ok",
      service: "app",
      phase: "0c",
      checks: {
        process: "ok",
        neon: "not-wired",
        upstash: "not-wired",
        r2: "not-wired",
      },
      timestamp: new Date().toISOString(),
    }),
    { headers },
  );
}
