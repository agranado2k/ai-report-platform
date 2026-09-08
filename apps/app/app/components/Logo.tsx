import type { ComponentProps } from "react";

/**
 * Centaur logomark — a violet arc (the AI) cradling a disc (the human): two
 * halves of one capable whole. Brand colours are intrinsic to the mark, so
 * they're literal hex rather than tokens — CSS vars don't resolve inside SVG
 * presentation attributes. The literals now mirror --brand (#7b68ee) and
 * --brand-hover (#5f4fd6) in theme.css (ADR-0086 brand violet); the earlier
 * copper/ember hex was left over from the retired Forge & Ember palette and its
 * comment falsely claimed to mirror --brand. Keep these in lockstep with
 * theme.css by hand.
 *
 * This renders VIOLET-ON-WHITE — the sidebar and auth-page lockups place it on a
 * light ground. The section-05 white-on-violet form (the glyph reversed out of a
 * filled violet tile) is a currentColor variant not needed by any current
 * placement; it would trade this literal-hex mark for a currentColor one, so it
 * stays a follow-up rather than a second component here.
 *
 * Decorative by default; the wrapping link/element should carry the label.
 */
export function Logo(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        d="M27 16a11 11 0 1 0-4.6 8.94"
        stroke="#7b68ee"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.6" fill="#5f4fd6" />
    </svg>
  );
}
