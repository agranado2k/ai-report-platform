import { Badge } from "./Badge";
import { cx } from "./cx";

/**
 * Published = a clean version is live; otherwise it's still being processed.
 * "Processing" (not "pending") avoids colliding with the `scan_status` "pending"
 * vocabulary in the glossary — this badge reflects publish state, not scan state.
 * A leading dot reinforces the state at a glance; it pulses while processing
 * (motion-safe, so it's static under prefers-reduced-motion).
 */
export function StatusBadge({ isPublished }: { isPublished: boolean }) {
  return (
    <Badge tone={isPublished ? "success" : "neutral"}>
      <span
        aria-hidden="true"
        className={cx(
          "mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current",
          !isPublished && "motion-safe:animate-pulse",
        )}
      />
      {isPublished ? "Published" : "Processing"}
    </Badge>
  );
}
