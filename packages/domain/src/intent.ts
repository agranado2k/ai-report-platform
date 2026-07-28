// Comment intent — what the author wants DONE with a `Comment` (ADR-0064
// Decision 8). A closed enumeration in the Authoring & Collaboration bounded
// context: `note` (the default — a human note, no agent action), `enhancement`
// (an agent should enhance the anchored context using the comment), `add` (add
// content per the comment), `remove` (remove content per the comment). The
// agent-action semantics that CONSUME an intent are deliberately out of scope
// here — this VO only carries the signal.
import type { AppError } from "./errors";
import { validationError } from "./errors";
import { err, ok, type Result } from "./result";

export const COMMENT_INTENTS = ["note", "enhancement", "add", "remove"] as const;
export type Intent = (typeof COMMENT_INTENTS)[number];

/** A comment with no explicit intent is a plain human note (backward compat: a
 *  pre-existing comment persisted before this field reads as `note`). */
export const DEFAULT_INTENT: Intent = "note";

function isIntent(raw: unknown): raw is Intent {
  return typeof raw === "string" && (COMMENT_INTENTS as readonly string[]).includes(raw);
}

/** Smart constructor at a trust boundary (HTTP body, use-case input): an ABSENT
 *  intent (`undefined`/`null`) defaults to `note`; a present-but-invalid value
 *  is REJECTED with a ValidationError (the HTTP adapter renders it 422). */
export function makeIntent(raw: unknown): Result<Intent, AppError> {
  if (raw === undefined || raw === null) return ok(DEFAULT_INTENT);
  if (isIntent(raw)) return ok(raw);
  return err(
    validationError(
      `invalid comment intent (expected one of ${COMMENT_INTENTS.join(", ")})`,
      "intent",
    ),
  );
}

/** Total variant for PERSISTENCE reads (`rowToComment`): a missing/unknown stored
 *  value degrades to `note` rather than failing the read — a legacy row written
 *  before the `intent` column existed reads as `note` (backward compat). */
export function intentOrDefault(raw: unknown): Intent {
  return isIntent(raw) ? raw : DEFAULT_INTENT;
}
