// The overlay-owned intent highlight palette (comment-UX adoptions, item A —
// the gap-analysis report's "Intent-colored highlights" + "Overlay owns its
// palette" rows). FIXED constants: the review overlay carries its own colors
// and must stay readable over ARBITRARY report styling, so nothing here is
// ever derived from the report document's CSS (the report is untrusted
// content — its stylesheet must not steer platform affordances).
//
// One entry per ADR-0064 Decision 8 intent. This module deliberately does NOT
// import the domain `Intent` union — arp-editor stays decoupled from
// arp-domain (same rationale as `CommentForHighlight`'s opaque `relative`
// slot); a compile-time drift guard against the domain enum lives in
// apps/view (intent-colors-drift.test.ts), where arp-domain IS a dependency.
//
// Color choices (semantic, WCAG-minded): each highlight is a translucent
// BACKGROUND tint (legible over light report themes without obscuring text)
// plus a stronger UNDERLINE (the inset box-shadow) that stays distinguishable
// over dark themes where a translucent tint alone would wash out.
//   note        → amber  (the pre-existing highlight color — visual continuity)
//   enhancement → indigo (matches the report ecosystem's "recommendation" accent)
//   add         → emerald (additive / go)
//   remove      → red    (destructive / stop)

export interface IntentHighlightColor {
  /** Translucent fill painted behind the anchored text. */
  readonly background: string;
  /** Stronger underline (inset box-shadow) — the dark-theme-safe signal. */
  readonly underline: string;
}

export const COMMENT_INTENT_COLORS = {
  note: {
    background: "rgba(244, 201, 93, 0.28)",
    underline: "rgba(244, 201, 93, 0.55)",
  },
  enhancement: {
    background: "rgba(129, 140, 248, 0.25)",
    underline: "rgba(79, 70, 229, 0.55)",
  },
  add: {
    background: "rgba(52, 211, 153, 0.25)",
    underline: "rgba(5, 150, 105, 0.55)",
  },
  remove: {
    background: "rgba(248, 113, 113, 0.25)",
    underline: "rgba(220, 38, 38, 0.55)",
  },
} as const satisfies Record<string, IntentHighlightColor>;

/** The closed set of intents this overlay can paint. Mirrors the domain
 *  `Intent` union (ADR-0064 Decision 8) — drift-guarded from apps/view. */
export type HighlightIntent = keyof typeof COMMENT_INTENT_COLORS;

/** Total mapping from the wire's `intent` (typed `string`, and possibly from
 *  a newer server with intents this build doesn't know) to a paintable
 *  intent. Unknown/missing values degrade to `note` — the calm default —
 *  never an unpainted or broken highlight. */
export function normalizeIntent(intent: unknown): HighlightIntent {
  return typeof intent === "string" && intent in COMMENT_INTENT_COLORS
    ? (intent as HighlightIntent)
    : "note";
}
