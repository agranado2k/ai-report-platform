// backfillDisplayNames — the one-time operator job (roadmap #59) that populates
// `users.display_name` for accounts mirrored BEFORE ADR-0063's JIT capture
// shipped (migration 0016 / PR #200), so they stop rendering as their email on
// comments/versions. Pure orchestration over two driven ports (ADR-0024): the
// IdentityStore (target-set query + null-guarded write) and a NARROW Clerk port
// (`ClerkDisplayNameSource`) — the real Clerk SDK lives in the entry-point
// adapter, never here, so this stays unit-testable with a fake.
//
// Guarantees:
//  - Idempotent: the write is `setDisplayNameIfNull` (SQL `IS NULL` guard), and
//    keyset pagination advances past every scanned row — so a re-run only ever
//    touches rows that are STILL null. Never overwrites a name captured elsewhere.
//  - Failure-isolated: one user's Clerk-fetch or write failure increments
//    `errors` and moves on; it never aborts the batch. Only a page-list failure
//    (a DB outage enumerating the target set) is fatal — we can't page without it.
//  - Fail-safe: `dryRun` reports what WOULD change and writes nothing; the caller
//    defaults it to `true`.
import { type AppError, ok, type Result, type UserId } from "arp-domain";
import type { CursorParams, IdentityStore } from "../ports";

/**
 * The single external capability the backfill needs from Clerk: resolve a user's
 * derived display name (already run through the shared `clerkDisplayName` /
 * `capDisplayName` rule) by Clerk user id, or null when Clerk exposes no usable
 * name. Fallible (`Result`) so a per-user Clerk outage is isolated into the
 * summary's `errors` rather than thrown. The real adapter wraps `@clerk/backend`
 * (`users.getUser` + `clerkDisplayName`); tests pass a fake.
 */
export interface ClerkDisplayNameSource {
  getDisplayName(clerkUserId: string): Promise<Result<string | null, AppError>>;
}

export interface BackfillDisplayNamesDeps {
  /** Only the two seams the job uses — a full IdentityStore satisfies this. */
  readonly identities: Pick<IdentityStore, "listUsersMissingDisplayName" | "setDisplayNameIfNull">;
  readonly clerk: ClerkDisplayNameSource;
}

export interface BackfillDisplayNamesCommand {
  /** Rows fetched per page (bounds memory; keyset-paginated). Must be ≥ 1. */
  readonly batchSize: number;
  /** When true, report what WOULD change and write nothing. Caller defaults true. */
  readonly dryRun: boolean;
  /** Optional hard cap on how many users to scan this run (safety valve for a
   *  first apply). Omitted → drain the whole target set. */
  readonly maxUsers?: number;
}

export interface BackfillDisplayNamesSummary {
  /** Target-set rows examined. */
  readonly scanned: number;
  /** Rows written (or, under `dryRun`, that WOULD be written). */
  readonly updated: number;
  /** Rows left unchanged: Clerk exposed no name, OR the null-guarded write found
   *  the row already set (a live provision raced us). */
  readonly skipped: number;
  /** Per-user failures (Clerk fetch or write) — isolated, never fatal. */
  readonly errors: number;
}

export async function backfillDisplayNames(
  deps: BackfillDisplayNamesDeps,
  cmd: BackfillDisplayNamesCommand,
): Promise<Result<BackfillDisplayNamesSummary, AppError>> {
  const batchSize = Math.max(1, cmd.batchSize);
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: UserId | undefined;

  for (;;) {
    if (cmd.maxUsers !== undefined && scanned >= cmd.maxUsers) break;
    // Cap the final page so we never scan past maxUsers.
    const remaining =
      cmd.maxUsers === undefined ? batchSize : Math.min(batchSize, cmd.maxUsers - scanned);
    const q: CursorParams<UserId> = { limit: remaining, startingAfter: cursor };
    const page = await deps.identities.listUsersMissingDisplayName(q);
    if (!page.ok) return page; // page-list failure is fatal — can't page the target set
    if (page.value.items.length === 0) break;

    for (const ref of page.value.items) {
      scanned += 1;
      cursor = ref.userId; // advance keyset regardless of outcome (no infinite loop)

      const name = await deps.clerk.getDisplayName(ref.clerkUserId);
      if (!name.ok) {
        errors += 1; // Clerk outage for THIS user — isolate, keep going
        continue;
      }
      if (name.value === null) {
        skipped += 1; // Clerk has no usable name — nothing to backfill
        continue;
      }
      if (cmd.dryRun) {
        updated += 1; // would-update; writes nothing
        continue;
      }
      const wrote = await deps.identities.setDisplayNameIfNull(ref.userId, name.value);
      if (!wrote.ok) {
        errors += 1; // write failed for THIS user — isolate, keep going
        continue;
      }
      if (wrote.value) updated += 1;
      else skipped += 1; // raced: already non-null when we went to write
    }

    if (!page.value.hasMore) break;
  }

  return ok({ scanned, updated, skipped, errors });
}
