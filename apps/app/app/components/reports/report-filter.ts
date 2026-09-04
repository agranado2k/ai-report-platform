// Pure helpers for the dashboard's filter-as-you-type (#334). The list is
// cursor-paginated SERVER-side (searchReports does the title/slug match), so
// filtering is debounced NAVIGATION — the typed query becomes `?q=` and the
// page reloads — not a client-side filter of the current page (which would
// silently only filter what's already loaded). Kept pure so the client island
// is a thin wrapper and this logic is unit-testable.

/** The URL a typed query should navigate to: set/clear `?q=`, PRESERVE the
 *  folder filter, and RESET cursor pagination (a new filter starts at page 1).
 *  `currentSearch` is `location.search` (may be empty or start with "?"). */
export function filterNavTarget(currentSearch: string, query: string): string {
  const params = new URLSearchParams(currentSearch);
  // A new filter invalidates the cursor position — drop both cursors.
  params.delete("starting_after");
  params.delete("ending_before");
  const q = query.trim();
  if (q) params.set("q", q);
  else params.delete("q");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** The "focus the filter from anywhere" key: a bare "/" (no modifier) while
 *  focus is NOT already in an editable field. `inField` is the caller's read of
 *  the current focus (see isEditableTarget in the shell). */
export function isFilterFocusKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  inField: boolean,
): boolean {
  return e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !inField;
}
