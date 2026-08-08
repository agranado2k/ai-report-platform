// An append-only, on-disk ledger of the Clerk objects THIS RUN created.
//
// THE LEAK IT CLOSES (issue #266). The per-scenario `After({ tags:
// "@run-scoped" })` hooks can only delete what a step assigned to a module
// variable — and `firstFixture = await ensureTeamFixtureUser(…)` assigns only
// once the WHOLE provisioning sequence returned. Every throw between
// `POST /users` succeeding and that return (the 402 at the decoy-org step, a
// 429 on the membership lookup) leaves a Clerk user that no variable, no hook
// and no later run knows about. Worse, those throws are exactly what a
// near-cap org produces — so the failure mode feeds itself.
//
// The registry is written the instant a remote object exists, before anything
// else can fail, and read by the Playwright global teardown. Cross-process by
// design: workers restart on failure (Playwright's default) and the global
// teardown runs in the top-level process, so module state cannot carry this.
//
// It lives beside the Playwright storageState under `tests/e2e/.auth/`, which
// is already gitignored — it holds Clerk object ids, not credentials, but the
// same "never commit run artifacts" rule applies.
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export type RegisteredKind = "user" | "organization";

export interface RegisteredIdentity {
  readonly kind: RegisteredKind;
  /** The Clerk object id — what the DELETE is addressed to. */
  readonly id: string;
  /** Human-readable (email / org name) so the teardown log names something. */
  readonly label: string;
}

/** Sibling of `STORAGE_STATE_PATH` — same gitignored directory. */
export const FIXTURE_REGISTRY_PATH = "tests/e2e/.auth/run-scoped-fixtures.jsonl";

const KINDS: readonly string[] = ["user", "organization"];

/** One JSONL record. Newline-terminated so a crash mid-append can only ever
 *  truncate the LAST line, which `parseRegistry` drops. */
export function serializeRegistryEntry(entry: RegisteredIdentity): string {
  return `${JSON.stringify({ kind: entry.kind, id: entry.id, label: entry.label })}\n`;
}

/**
 * Read a registry back. Pure, total, and deliberately forgiving: it is parsed
 * after the events that make it useful (crashes, hard kills), so a truncated
 * final line is the NORMAL case. Anything unparseable or shapeless is skipped
 * rather than thrown — a teardown that dies on its own input deletes nothing.
 * De-duplicated by kind+id so a re-recorded object is deleted once.
 */
export function parseRegistry(text: string): readonly RegisteredIdentity[] {
  const seen = new Set<string>();
  const entries: RegisteredIdentity[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // truncated tail, or a partially flushed write
    }
    if (typeof parsed !== "object" || parsed === null) continue;

    const { kind, id, label } = parsed as Record<string, unknown>;
    if (typeof kind !== "string" || !KINDS.includes(kind)) continue;
    if (typeof id !== "string" || id.length === 0) continue;

    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      kind: kind as RegisteredKind,
      id,
      label: typeof label === "string" && label.length > 0 ? label : id,
    });
  }

  return entries;
}

/**
 * Record a just-created Clerk object. NEVER throws: this is called from the
 * provisioning path, and a registry write failing must not be the thing that
 * fails a scenario — it degrades cleanup back to today's behaviour, no worse.
 */
export function recordProvisionedIdentity(entry: RegisteredIdentity): void {
  try {
    mkdirSync(dirname(FIXTURE_REGISTRY_PATH), { recursive: true });
    appendFileSync(FIXTURE_REGISTRY_PATH, serializeRegistryEntry(entry), "utf8");
  } catch (error) {
    console.warn(
      `run-scoped registry: could not record ${entry.kind} ${entry.id} — ${String(error)}. ` +
        "A crash before its cleanup hook would leak it until the next sweep.",
    );
  }
}

/** Everything this run recorded. Empty when the file does not exist. */
export function readProvisionedIdentities(): readonly RegisteredIdentity[] {
  try {
    return parseRegistry(readFileSync(FIXTURE_REGISTRY_PATH, "utf8"));
  } catch {
    return [];
  }
}

/** Drop the ledger — called at global SETUP so a run never inherits a stale
 *  file from a previous invocation on the same checkout. */
export function resetProvisionedIdentities(): void {
  try {
    rmSync(FIXTURE_REGISTRY_PATH, { force: true });
  } catch {
    // A stale registry only ever causes extra 404-tolerated DELETEs.
  }
}
