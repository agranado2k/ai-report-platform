// pg-boss instance lifecycle (the async scan queue's delivery engine). Memoized
// per warm lambda: the first call starts pg-boss and ensures the `scan` queue.
//
// SCHEMA OWNERSHIP (ADR-0045): pg-boss owns its dedicated `pgboss` schema and
// migrates it itself (`migrate: true`). The `app` role owns the database, so it
// can CREATE that schema with no extra grant. This is a deliberate exception to
// the everything-as-code migrate-db pipeline (ADR-017/018), made because
// pg-boss 12's per-queue partitioned tables can't be cleanly frozen into a
// static migration. Our own app tables in `public` still go through Drizzle.
// The supervisor + cron scheduler are OFF — this is a stateless drain driven by
// an external (Cloudflare cron) trigger, not a long-lived worker process.
//
// SWAPPABILITY (ADR-0045): pg-boss is confined to this file + PgBossScanWorkQueue.
// The application depends only on the ScanWorkQueue port, so replacing pg-boss
// (e.g. with a Postgres SKIP-LOCKED queue or a managed queue) is a localized
// adapter change — nothing in domain/application moves.
import { PgBoss } from "pg-boss";

/** The single pg-boss queue name for content scans. */
export const SCAN_QUEUE = "scan";

let ready: Promise<PgBoss> | undefined;

/**
 * Get the started, queue-ready pg-boss instance for the given connection.
 * Memoized; safe to call on every drain invocation. On failure the memo is
 * cleared so a later cold start retries rather than caching a rejection.
 */
export function getBoss(connectionString: string): Promise<PgBoss> {
  if (ready) return ready;
  ready = (async () => {
    const boss = new PgBoss({
      connectionString,
      schema: "pgboss",
      // Tiny pool — this runs on a serverless function; pg-boss must not hog
      // Neon connections (it uses node-postgres TCP, separate from the app's
      // WebSocket pool — point it at the pooled Neon URL, see container.server).
      max: 2,
      supervise: false,
      schedule: false,
      migrate: true,
    });
    await boss.start();
    await boss.createQueue(SCAN_QUEUE);
    return boss;
  })().catch((e) => {
    ready = undefined;
    throw e;
  });
  return ready;
}
