// Pure URL-building for GET /<slug>/edit's 302 redirect (ADR-0063 Decision 3
// — "dashboard-origin editing with a deep-link fallback"). This is the
// interim answer while the full in-viewer editing route (ADR-0063 Decisions
// 1-2, the two-CSP-profile approach) stays gated behind its required
// `/security-review` pass: instead of serving an authenticated editor on the
// viewer origin, `/<slug>/edit` is a PURE, unauthenticated redirect to the
// dashboard's own edit route — no JS, no HTML, no session concept added to
// view.<domain> at all.
//
// Fails closed (returns null) when APP_ORIGIN is unset (previews/dev without
// the env wired) rather than falling back to the request's own origin — the
// viewer origin must never construct a same-origin "edit" URL, since there is
// no editor here to send anyone to.
export function buildEditRedirectLocation(
  appOrigin: string | undefined,
  slug: string,
): string | null {
  if (!appOrigin) return null;
  const origin = appOrigin.replace(/\/+$/, "");
  return `${origin}/reports/${slug}/edit`;
}
