/**
 * The mutating-write TAIL, owned once instead of pasted twenty times.
 *
 * Every mutating use case ends the same way: open the transaction, mutate,
 * write the audit row, complete the idempotency record, return. That sequence
 * is ADR-0070's commit-last atomicity requirement plus ADR-0039's
 * crash-consistency requirement, and before this module it was inlined at 20
 * call sites — roughly 717 lines, 27% of all mutating use-case code — with the
 * ordering held by comment and review rather than by types.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN: the idempotency CLAIM. Its position is
 * not uniform and cannot be made so. Delete-shaped use cases claim BEFORE the
 * load (`delete-report`, `delete-folder`, `delete-comment`), because a retry's
 * own load would 404 and the recorded 204 is the whole point; everything else
 * claims AFTER load+authz so a rejected request never poisons a key; and
 * `uploadReport` claims after bundle processing but before the plan-limit check,
 * because its derived key needs the content hash. Three orderings, each load-
 * dependent. A construct that swallowed the claim would have to take the load
 * as a callback too, which moves the complexity rather than concentrating it.
 *
 * So the seam sits after the claim: the caller decides WHEN to claim, and this
 * module makes everything after it mechanical — including the two rules that
 * were only ever comments: audit and complete are co-equal-last INSIDE the
 * transaction, and `complete` runs only when a ref exists (an `unsound`
 * operation with no client key claims nothing, so there is nothing to complete).
 */

import type { AppError, Result } from "arp-domain";
import { ok } from "arp-domain";
import type { AuditEntry } from "./audit";
import type {
  AuditLogger,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  UnitOfWork,
} from "./ports";

export interface CommitWriteDeps {
  readonly uow: UnitOfWork;
  readonly audit: AuditLogger;
  readonly idempotency: IdempotencyStore;
}

export interface CommitWriteSpec<T> {
  /**
   * The claim, when one was made. Absent for an `unsound` operation the client
   * sent no `Idempotency-Key` for — those claim nothing, so there is nothing to
   * complete. Passing it through as `undefined` is the normal case, not an edge.
   */
  readonly idemRef?: IdempotencyKeyRef | undefined;
  /**
   * The audit rows, derived from what the mutation actually did — `setAcl` and
   * `setReportSharing` emit a second row only when they also revoked a grant,
   * so this cannot be a fixed list.
   */
  readonly audit: (value: T) => readonly AuditEntry[];
  /** The response to record for a later replay. Never called without a ref. */
  readonly response: (value: T) => IdempotencyRecord;
}

/**
 * Run `mutate` inside the unit of work, then the audit row, then the
 * idempotency completion — and roll all three back together if any step fails.
 *
 * Returns whatever `mutate` returned, so the caller's own result type is
 * unchanged.
 */
export async function commitWrite<T>(
  deps: CommitWriteDeps,
  spec: CommitWriteSpec<T>,
  mutate: () => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  return deps.uow.run(async () => {
    const mutated = await mutate();
    if (!mutated.ok) return mutated;

    const audited = await deps.audit.record(spec.audit(mutated.value));
    if (!audited.ok) return audited;

    if (spec.idemRef) {
      const done = await deps.idempotency.complete(spec.idemRef, spec.response(mutated.value));
      if (!done.ok) return done;
    }
    return ok(mutated.value);
  });
}
