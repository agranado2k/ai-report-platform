// The comment-intent labels + composer options, shared by EVERY surface that
// lets a user pick an intent (ADR-0064 Decision 8): the Comments panel's
// edit/reply forms and the Floating composer (ticket #298). Extracted from
// CommentsPanel.tsx so the two composers can never drift on labels/ordering.
//
// TYPE-ONLY import (erased at build): pulling a VALUE from the `arp-domain`
// barrel drags its `node:crypto`-using modules (signed-token) into this
// browser bundle and breaks the Vite/Rollup build. The `Intent` type costs
// nothing at runtime, and `Record<Intent, …>` below still gives us
// drift-safety.
import type { Intent } from "arp-domain";
// TYPE-ONLY import (erased at build): only the `BadgeTone` union, no arp-ui
// runtime — the tone map below is data, consumed by the Comments panel's pills.
import type { BadgeTone } from "arp-ui";

/** Human-facing labels, keyed by the domain `Intent` union. Typed as
 *  `Record<Intent, string>` so it stays EXHAUSTIVE at compile time: adding a
 *  fifth member to the domain enum breaks the build here until it gets a label
 *  — the same drift-safety a runtime `COMMENT_INTENTS` import would give, but
 *  without dragging the domain barrel (and its `node:crypto` deps) into the
 *  browser bundle. */
export const INTENT_LABELS: Record<Intent, string> = {
  note: "Note",
  enhancement: "Enhance",
  add: "Add",
  remove: "Remove",
};

/** The Badge tone each intent wears as a scannable pill in the Comments panel
 *  (T8, report Z0W60dI8hu §06 — "the intents become pills the reader can
 *  scan"). Typed `Record<Intent, BadgeTone>` so it stays EXHAUSTIVE at compile
 *  time, same drift-safety as `INTENT_LABELS`. Semantic, not decorative: `add`
 *  reads as additive (success/green), `remove` as removal (danger/red),
 *  `enhancement` as a suggestion to weigh (warning/amber), and `note` as a
 *  neutral remark (info/sky) — presentation only, the intents themselves are
 *  unchanged. */
export const INTENT_TONES: Record<Intent, BadgeTone> = {
  note: "info",
  enhancement: "warning",
  add: "success",
  remove: "danger",
};

/** The comment-intent options surfaced in the composers (ADR-0064 Decision 8),
 *  derived from the exhaustive label map so they never drift. `note` is the
 *  default; the value is the wire enum, the label is human-facing. */
export const INTENT_OPTIONS: readonly { readonly value: Intent; readonly label: string }[] = (
  Object.keys(INTENT_LABELS) as Intent[]
).map((value) => ({ value, label: INTENT_LABELS[value] }));
