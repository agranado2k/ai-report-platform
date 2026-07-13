// Shared Clerk → display-name derivation (ADR-0063 author display). Extracted
// from auth.server.ts so the exact SAME rule (fullName → firstName lastName →
// username → null, capped at DISPLAY_NAME_MAX) backs BOTH live JIT provisioning
// (the write/OAuth paths) AND the one-time display_name backfill (roadmap #59).
// Deliberately Remix-free (no `.server` imports) so it's importable from any
// server module without dragging the Remix runtime in.

// Bound the mirrored display name so an over-long Clerk name can't blow out the
// stored row / panel layout (claude-review #200). It's React-escaped at render
// and only shown to in-org collaborators, so this is defense-in-depth, applied
// at every capture point.
export const DISPLAY_NAME_MAX = 120;

export function capDisplayName(name: string): string {
  return name.length > DISPLAY_NAME_MAX ? name.slice(0, DISPLAY_NAME_MAX) : name;
}

/** Derive a human display name from a Clerk backend user object (ADR-0063):
 *  prefer `fullName`, else `firstName lastName`, else `username`, else null. */
export function clerkDisplayName(user: {
  readonly fullName?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly username?: string | null;
}): string | null {
  const full = user.fullName?.trim();
  if (full) return capDisplayName(full);
  const composed = [user.firstName, user.lastName]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(" ");
  if (composed) return capDisplayName(composed);
  const username = user.username?.trim();
  return username && username.length > 0 ? capDisplayName(username) : null;
}
