// The /health JSON body (issue #149 — smoke reliability). Pure, injectable
// builder so the DB-ping and isolation-marker logic gets full unit coverage
// without touching a real Neon connection — the route loader (health.tsx)
// wires in the REAL DbContext ping + defineEnv(), lazily, and stays thin.
//
// FAIL-SOFT by construction: `pingDb` is awaited inside try/catch here, so a
// throwing ping can never propagate out of `buildHealthBody` and 500 the
// route. The CI readiness gate (.github/workflows/e2e.yml) polls this body to
// decide whether the deployment it's looking at is the fully-isolated,
// DB-ready preview (ADR-0047) — a health route that itself 500s on a bad
// DATABASE_URL would defeat that gate.
export type HealthEnvMarkers = {
  readonly r2KeyPrefix?: string;
  readonly neonBranch?: string;
};

export type BuildHealthBodyDeps = {
  /** Run a trivial DB round-trip (e.g. `SELECT 1`); reject on any failure. */
  readonly pingDb: () => Promise<void>;
  readonly env: HealthEnvMarkers;
  readonly commit: string;
  readonly version: string;
  /** Injectable clock for tests; defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
};

export type HealthBody = {
  readonly status: "ok";
  readonly service: "app";
  readonly phase: "0c";
  readonly version: string;
  readonly commit: string;
  readonly checks: {
    readonly process: "ok";
    readonly neon: "ok" | "error";
    readonly upstash: "not-wired";
    readonly r2: "not-wired";
  };
  /** True once this deployment carries an explicit isolation marker
   *  (NEON_BRANCH or R2_KEY_PREFIX) injected by preview-isolation.yml —
   *  distinguishes the isolated redeploy from the pre-isolation one that
   *  raced it (both emit a `deployment_status: success`, ADR-0047). */
  readonly isolated: boolean;
  readonly neonBranch: string | null;
  readonly timestamp: string;
};

async function pingNeon(pingDb: () => Promise<void>): Promise<"ok" | "error"> {
  try {
    await pingDb();
    return "ok";
  } catch {
    return "error";
  }
}

export async function buildHealthBody(deps: BuildHealthBodyDeps): Promise<HealthBody> {
  const neon = await pingNeon(deps.pingDb);
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    status: "ok",
    service: "app",
    phase: "0c",
    version: deps.version,
    commit: deps.commit,
    checks: {
      process: "ok",
      neon,
      upstash: "not-wired",
      r2: "not-wired",
    },
    isolated: Boolean(deps.env.r2KeyPrefix || deps.env.neonBranch),
    neonBranch: deps.env.neonBranch ?? null,
    timestamp: now(),
  };
}
