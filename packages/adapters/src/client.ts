// Neon/Drizzle client + a shared "executor" context so the repository, outbox,
// and idempotency adapters can run inside ONE transaction when the UnitOfWork
// opens it (ADR-0037 §5 commit-last atomicity). Boundary layer (ADR-0020).
//
// We use drizzle-orm/neon-serverless (WebSocket Pool) rather than neon-http so
// transactions are supported. On Vercel's Node runtime the Pool is fine.
import { AsyncLocalStorage } from "node:async_hooks";
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
  // Set only on the URL-backed (production) path; undefined when a Db is injected.
  private readonly pool?: Pool;
  // Per-async-context tx executor (NOT a shared mutable field) so concurrent
  // requests on a warm lambda never clobber each other's transaction.
  private readonly als = new AsyncLocalStorage<Db>();

  // Production builds the Neon Pool from a URL; tests inject an already-built
  // (pglite-backed) Db to exercise the real adapter SQL in-process.
  constructor(databaseUrl: string);
  constructor(injected: { readonly base: Db });
  constructor(arg: string | { readonly base: Db }) {
    if (typeof arg === "string") {
      this.pool = new Pool({ connectionString: arg });
      this.base = drizzle(this.pool, { schema });
    } else {
      this.base = arg.base;
    }
  }

  /** The executor to run queries against — the open tx if inside run(), else base. */
  current(): Db {
    return this.als.getStore() ?? this.base;
  }

  /** Run `work` inside a single transaction; adapters' writes share it. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    return this.base.transaction(async (tx) =>
      // Scope the tx to this async call stack; current() reads it via the ALS.
      // The cast bridges the nominal PgTransaction/NeonDatabase types.
      this.als.run(tx as unknown as Db, work),
    );
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export { schema };
