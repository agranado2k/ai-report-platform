// Anchor — the two-part, degrading location a `Comment` attaches to (ADR-0064
// §2a, Authoring & Collaboration). v1 always populates `versionPinned` (a
// `ReportVersion` id + a text-quote snapshot of the anchored content); `relative`
// is an opaque slot for a future Yjs-relative ProseMirror position (ADR-0062/
// ADR-0067) that the editor slice will populate later.
//
// JUDGMENT CALL: `relative` is deliberately `unknown` (untyped/optional), not the
// ProseMirror position type from packages/report-html — the domain layer must not
// depend on the editor's document model (ADR-024 keeps packages/domain dependency-
// free), and that package doesn't exist as a JS-facing shape yet. Whichever use
// case eventually resolves/writes a relative position casts at its own boundary.
import type { VersionId } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import { err, ok, type Result } from "./result";

export interface VersionPinnedAnchor {
  readonly versionId: VersionId;
  /** A snapshot of the anchored text — lets the UI show "what this comment is
   *  about" even once the live document has drifted past resolvability. */
  readonly textQuote: string;
}

export interface Anchor {
  readonly versionPinned: VersionPinnedAnchor;
  /** Opaque Yjs-relative-position payload (ADR-0067), populated by the editor
   *  slice once it exists. Absent today — every comment degrades-to/starts-at
   *  the version-pinned fallback (ADR-0064 §2a). */
  readonly relative?: unknown;
}

// JUDGMENT CALL: ADR-0064 doesn't specify a text-quote length limit. Capped here
// for the same reason the comment body is bounded (§2: "a short annotation, not
// a document") — an anchor snapshot shouldn't become a second unbounded document.
const MAX_TEXT_QUOTE = 2000;

/** Validate an Anchor's bounded fields. */
export function validateAnchor(anchor: Anchor): Result<Anchor, AppError> {
  const quote = anchor.versionPinned.textQuote;
  if (quote.trim().length === 0) {
    return err(validationError("anchor text quote is required", "anchor"));
  }
  if (quote.length > MAX_TEXT_QUOTE) {
    return err(validationError(`anchor text quote too long (max ${MAX_TEXT_QUOTE})`, "anchor"));
  }
  return ok(anchor);
}
