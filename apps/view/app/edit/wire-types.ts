// Wire (snake_case) shapes returned by the app-origin REST API's `/comments`,
// `/versions`, and `/diff` endpoints (ADR-0053 resources, ADR-0063 edit-token
// API acceptance seam) — the unified-experience epic's Comments / Versions /
// Compare tabs. Re-exported from the `arp-http/wire` catalog: the SAME type
// declarations the server's response encoders are compiled against, so the
// client's view of the wire can no longer drift from what the server emits.
// The subpath is browser-safe by construction (type declarations + type-only
// arp-domain imports only — nothing server-only, no runtime footprint). Kept
// as a thin local module so the edit slice's many importers keep their
// `./wire-types` import path.
//
// Notes that used to live on the hand-maintained copies, still true:
// - `CommentWire.anchor.relative`, when present, is the SAME opaque shape
//   `arp-editor`'s `CommentForHighlight` expects — a `CommentWire` is directly
//   assignable to it (both carry `id` + `anchor.relative`), no mapping needed
//   for highlight decorations.
// - `DiffWire.html` is a BODY FRAGMENT (already-sanitized markup, never a full
//   document) — the caller must reinject it into the report's own shell
//   (`reinjectShell`, arp-report-html) and render the result through
//   `buildReadOnlyIframeDocument`'s sandboxed `srcDoc`, per F-1. Never render
//   via `dangerouslySetInnerHTML`.
export type { CommentWire, DiffWire, ListEnvelope, VersionWire } from "arp-http/wire";
