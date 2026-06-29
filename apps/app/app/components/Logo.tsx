import type { ComponentProps } from "react";

/**
 * Centaur logomark — a copper arc (the AI) cradling an ember disc (the human):
 * two halves of one capable whole. Brand colours are intrinsic to the mark, so
 * they're literal hex (mirroring --brand / --brand-hover in theme.css) rather
 * than tokens — CSS vars don't resolve inside SVG presentation attributes.
 * Decorative by default; the wrapping link/element should carry the label.
 */
export function Logo(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        d="M27 16a11 11 0 1 0-4.6 8.94"
        stroke="#c8762d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.6" fill="#e8a04c" />
    </svg>
  );
}
