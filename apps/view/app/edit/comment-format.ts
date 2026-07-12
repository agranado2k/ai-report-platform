// Pure presentation helpers for the in-viewer editor's Comments / Versions
// panels (comment-display-polish). Extracted from the TSX components so their
// logic is unit-testable: apps/view has NO jsdom/component test tier (vitest
// `environment: "node"`; see the root vitest.config.ts glob
// `apps/view/app/edit/**/*.test.ts`), so DOM-mount tests aren't possible —
// these pure helpers are tested directly in `comment-format.test.ts` instead.
// No React / DOM / arp-domain-VALUE imports here (a value import from the
// `arp-domain` barrel drags `node:crypto` into the browser bundle and breaks
// the Vite/Rollup build).

/** Derive a short circular-avatar label for an author (ADR-0063 author display).
 *  Prefers the display NAME when present: the first alnum char of each of the
 *  first two words — `"Jane Doe"` → `"JD"`, `"Jane"` → `"JA"` (a single word
 *  falls back to its first two alnum chars, like an email local-part). Otherwise
 *  derives from the EMAIL local-part (before the `@`) the same way —
 *  `jane@x.com` → `JA`, `j@x.com` → `J`. Uppercased. Returns `"?"` when neither
 *  yields any alnum char (both null/empty). Pure. */
export function authorInitials(name: string | null, email: string | null): string {
  const fromName = initialsFromName(name);
  if (fromName) return fromName;
  return initialsFromLocalPart(email?.split("@")[0] ?? null) ?? "?";
}

/** Initials from a multi-word display name: first alnum char of the first two
 *  words. A single word degrades to its first two alnum chars. null when no word
 *  carries an alnum char. */
function initialsFromName(name: string | null): string | null {
  if (!name) return null;
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  if (words.length === 1) return initialsFromLocalPart(words[0] ?? null);
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

/** First two alnum chars of a local-part-like string, uppercased; null when none. */
function initialsFromLocalPart(localPart: string | null): string | null {
  if (!localPart) return null;
  const alnum = localPart.replace(/[^a-zA-Z0-9]/g, "");
  if (alnum.length === 0) return null;
  return alnum.slice(0, 2).toUpperCase();
}

// A single shared formatter — narrow style yields the compact `5m ago` /
// `2h ago` / `3d ago` forms; `numeric: "always"` keeps it uniform (never
// "yesterday"). Constructed once so we don't rebuild it per render.
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

/** Format an ISO timestamp as a compact relative string against `nowMs`:
 *  `"just now"` under a minute, else `"5m ago"` / `"2h ago"` / `"3d ago"` via
 *  the built-in `Intl.RelativeTimeFormat` (no dependency). `nowMs` is injectable
 *  so the mapping is deterministically testable; it defaults to the current
 *  clock. Pure (given `nowMs`). The absolute time stays available as the
 *  element's `title` — see the panels. */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const diffMs = new Date(iso).getTime() - nowMs;
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 60) return "just now";
  if (absSec < 3600) return RELATIVE_FORMAT.format(Math.round(diffMs / 60_000), "minute");
  if (absSec < 86_400) return RELATIVE_FORMAT.format(Math.round(diffMs / 3_600_000), "hour");
  return RELATIVE_FORMAT.format(Math.round(diffMs / 86_400_000), "day");
}
