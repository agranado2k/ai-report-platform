// Neon/Drizzle client + a shared "executor" context so the repository, outbox,
// and idempotency adapters can run inside ONE transaction when the UnitOfWork
// opens it (ADR-0037 §5 commit-last atomicity). Boundary layer (ADR-0020).
//
// We use drizzle-orm/neon-serverless (WebSocket Pool) rather than neon-http so
// transactions are supported. On Vercel's Node runtime the Pool is fine.
import { Pool } from "@neondatabase/serverless";
import * as schema from "arp-db/schema";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

export type Db = NeonDatabase<typeof schema>;

/**
 * Holds the active executor: the base pool normally, or the open transaction
 * while `run()` is in flight. The adapters read `current()` per query so a
 * UnitOfWork.run() makes their writes commit together.
 */
export class DbContext {
  readonly base: Db;
  private readonly pool: Pool;
  private exec: Db;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.base = drizzle(this.pool, { schema });
    this.exec = this.base;
  }

  /** The executor to run queries against — the open tx if inside run(), else base. */
  current(): Db {
    return this.exec;
  }

  /** Run `work` inside a single transaction; adapters' writes share it. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    return this.base.transaction(async (tx) => {
      // tx and base share the query-builder surface; the cast bridges the
      // nominal PgTransaction/NeonDatabase types (same runtime methods).
      this.exec = tx as unknown as Db;
      try {
        return await work();
      } finally {
        this.exec = this.base;
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { schema };
