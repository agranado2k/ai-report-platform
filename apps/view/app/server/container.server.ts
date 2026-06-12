// Composition root for the viewer origin (server-only). The viewer is I/O-light:
// a single slug→report lookup (Drizzle/Neon) + one R2 read per request. So it
// wires only the two ports it needs — NOT the full upload deps. Boundary layer
// (ADR-0020): the only place apps/view assembles concrete adapters. Env via
// defineEnv() (arp-env, ADR-0043). One DbContext + deps set per warm lambda.
import { DbContext, DrizzleReportRepository, R2BlobStore } from "arp-adapters";
import type { BlobStore, ReportRepository } from "arp-application";
import { defineEnv } from "arp-env";

export interface ViewerDeps {
  readonly reports: ReportRepository;
  readonly blobs: BlobStore;
}

let _ctx: DbContext | undefined;
let _deps: ViewerDeps | undefined;

function context(): DbContext {
  if (_ctx) return _ctx;
  _ctx = new DbContext(defineEnv().DATABASE_URL);
  return _ctx;
}

export function viewerDeps(): ViewerDeps {
  if (_deps) return _deps;
  const env = defineEnv();
  _deps = {
    reports: new DrizzleReportRepository(context()),
    blobs: new R2BlobStore({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    }),
  };
  return _deps;
}
