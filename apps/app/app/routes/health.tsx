import type { LoaderFunctionArgs } from "@remix-run/node";
import { defineEnv } from "arp-env";
import { appHeaders } from "arp-headers/app";
import pkg from "../../package.json";
import { buildHealthBody, type HealthEnvMarkers } from "../server/health.server";

// The isolation markers ONLY (NEON_BRANCH / R2_KEY_PREFIX), read WITHOUT going
// through the full defineEnv() contract when that throws. defineEnv() asserts
// every required secret (CLERK_SECRET_KEY, R2_*, DATABASE_URL, ...) — a
// misconfigured deploy (e.g. the PUBLIC_CLERK_PUBLISHABLE_KEY name-mismatch
// pitfall documented in docs/infra.md) would make it throw, and this route
// must NEVER 500 just because some unrelated var is missing (the CI readiness
// gate depends on always getting a 200 body back). Prefer defineEnv() when it
// succeeds (the validated, trimmed accessor); fall back to the raw optional
// vars — safe because both are optional at the schema layer too — otherwise.
function isolationEnv(): HealthEnvMarkers {
  try {
    const env = defineEnv();
    return { r2KeyPrefix: env.R2_KEY_PREFIX, neonBranch: env.NEON_BRANCH };
  } catch {
    return {
      r2KeyPrefix: process.env.R2_KEY_PREFIX,
      neonBranch: process.env.NEON_BRANCH,
    };
  }
}

export async function loader(_args: LoaderFunctionArgs) {
  const headers = appHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  const body = await buildHealthBody({
    env: isolationEnv(),
    // Vercel injects VERCEL_GIT_COMMIT_SHA at build + runtime; "dev" locally.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    version: pkg.version,
    pingDb: async () => {
      // Lazy imports: the composition root (container.server) pulls in the
      // FULL adapters graph (Neon Pool, R2, Clerk, pg-boss, ...). Importing
      // that eagerly at route-module load risks taking the whole route down
      // if that graph ever fails to load — the exact shape of the 2026-07-08
      // jsdom-un-shippable incident (docs/diary.md), just for a different
      // dependency. Resolved only when the loader actually runs; any failure
      // here is caught by buildHealthBody → checks.neon:"error".
      // `pingDb` is arp-adapters' own helper (packages/adapters/src/client.ts)
      // — reuses the SAME DbContext/executor every repository queries through,
      // rather than adding a fresh drizzle-orm dependency to this app.
      const [{ pingDb }, { dbContext }] = await Promise.all([
        import("arp-adapters"),
        import("../server/container.server"),
      ]);
      await pingDb(dbContext());
    },
  });

  return new Response(JSON.stringify(body), { headers });
}
