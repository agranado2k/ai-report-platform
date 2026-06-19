import { Badge } from "./Badge";

/**
 * Published = a clean version is live; otherwise it's still being processed.
 * "Processing" (not "pending") avoids colliding with the `scan_status` "pending"
 * vocabulary in the glossary — this badge reflects publish state, not scan state.
 */
export function StatusBadge({ isPublished }: { isPublished: boolean }) {
  return (
    <Badge tone={isPublished ? "success" : "neutral"}>
      {isPublished ? "Published" : "Processing"}
    </Badge>
  );
}
