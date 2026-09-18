// The editor's side-panel hint — the closed set of panels a URL may ASK the
// in-viewer editor to open on, and the one way to put that ask into a URL
// (#377, carried through the edit funnel by #382).
//
// WHY IT LIVES IN THE DOMAIN PACKAGE rather than beside the panel it names.
// The hint crosses BOTH origins. It is written by the owner view's Versions
// action on the view origin, re-emitted by the view gate's funnel to the app's
// ONE mint, threaded through `ownerOpenLocation` on the app origin, and read
// back by the editor after the gate's clean-URL 303 — four hops across two
// deployments. `apps/view` cannot import from `apps/app` and vice versa, so
// the alternative to a shared vocabulary is a second copy of the enum in the
// app, silently disagreeing with the panel the day a third tab is added. This
// package is the only dependency-free thing both apps already import, and the
// shape — a closed enumeration with a total reader — is exactly `intent.ts`'s.
//
// A HINT, NEVER A CAPABILITY. Nothing here is consulted by a gate, a cookie, a
// header profile or an ACL. It selects which tab a panel the caller could
// already open starts on. An unknown value is therefore not an error to
// report: it is simply not a hint, and is DROPPED before any redirect is
// built, so the only thing that can reach a `panel=` in a URL this system
// emits is a member of the enum below.

/** The panels the editor's side panel can show — and therefore the complete
 *  set a URL is allowed to name. One list so a third tab cannot become
 *  deep-linkable by accident, nor stay un-linkable by omission. */
export const EDITOR_PANELS = ["comments", "versions"] as const;

/** A panel the editor can open on. Also the editor's in-app tab vocabulary
 *  (`PanelTab` in apps/view is this type). */
export type EditorPanel = (typeof EDITOR_PANELS)[number];

/**
 * Read a panel hint off untrusted input — a search param, a route param, a
 * value forwarded from another origin.
 *
 * TOTAL, and deliberately undefined-returning rather than `Result`: absence
 * and rubbish mean the same thing to every caller (fall back to the panel's
 * own default), and a hint that could fail a request would be a capability
 * with extra steps.
 */
export function readPanelHint(raw: unknown): EditorPanel | undefined {
  // Membership IS the whole check: the enum holds only strings, so a number,
  // an object or an array of a valid value fails it on its own. A `typeof`
  // guard in front would be a branch no input can take — dead at runtime, and
  // an equivalent mutant Stryker would (rightly) report as unkillable.
  return (EDITOR_PANELS as readonly unknown[]).includes(raw) ? (raw as EditorPanel) : undefined;
}

/**
 * Append a panel hint to a URL, or hand the URL back unchanged when there is
 * no hint to carry.
 *
 * ONE builder for all three hops that forward the hint (the view gate's funnel
 * target, the app's owner-open location, the gate's clean-URL hand-off). Each
 * of those URLs differs in whether it already carries a query — `?to=edit`,
 * `?et=…`, nothing at all — and a `?`-vs-`&` decision taken separately three
 * times is a bug waiting for the fourth caller.
 *
 * The `panel` parameter is TYPED, so the only value that can reach a URL is
 * one `readPanelHint` admitted; the encode is belt-and-braces for a future
 * enum member that is not URL-safe.
 */
export function withPanelHint(url: string, panel: EditorPanel | undefined): string {
  if (!panel) return url;
  return `${url}${url.includes("?") ? "&" : "?"}panel=${encodeURIComponent(panel)}`;
}
