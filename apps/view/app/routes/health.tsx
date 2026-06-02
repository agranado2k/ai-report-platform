import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader(_args: LoaderFunctionArgs) {
  return Response.json(
    {
      status: "ok",
      service: "view",
      phase: "0c",
      checks: {
        process: "ok",
        edge_middleware: "not-wired",
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
