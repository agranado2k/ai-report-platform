import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    {
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
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
