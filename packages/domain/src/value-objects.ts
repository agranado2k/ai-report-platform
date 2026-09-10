// Closed enumerations shared across the Reports & Folders aggregate.

export const SCAN_STATUSES = ["pending", "clean", "flagged", "blocked"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/**
 * A scan *result* is always terminal — a completed `ScanJob` reports
 * `clean`/`flagged`/`blocked`, never `pending`. Used to narrow verdict-carrying
 * APIs so `pending` can't be passed as an outcome.
 */
export type TerminalScanStatus = Exclude<ScanStatus, "pending">;

/** Only a clean version may be served / become the live version (ADR-0037 §8). */
export const isServable = (status: ScanStatus): boolean => status === "clean";

export const ACL_MODES = ["private", "public", "password", "org", "allowlist"] as const;
export type AclMode = (typeof ACL_MODES)[number];

export const GRANT_LEVELS = ["editor", "admin"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];

/** The two `Org` kinds (ADR-0061, resolved by ADR-0068 §1): `personal` is 1:1
 *  with a public-provider-address user (never gains members); `team` is a
 *  corporate-domain org, multi-member by design (every same-domain sign-up
 *  joins it). Persisted as `orgs.kind` (default `personal`). */
export const ORG_KINDS = ["personal", "team"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** How a `ReportVersion` was produced (ADR-0062 §6, surfaced by ADR-0065): `upload`
 *  is a plain file/zip upload; `editor` is a save from the in-app ProseMirror editor
 *  (ADR-0062) — not yet buildable, so every version is `upload` today. */
export const VERSION_ORIGINS = ["upload", "editor"] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

/**
 * **Editability** (ADR-0080) — the recorded verdict of the editor's own
 * open-time precondition, run against a `ReportVersion`'s stored bytes at the
 * moment they were written.
 *
 * Uploads are stored VERBATIM and the viewer streams them unchanged (ADR-0038),
 * while the editor additionally needs the presentation shell to split off an
 * editable body (ADR-0062 §2) and — absent a `_source.json` sidecar — that body
 * to parse into `reportSchema`. So a document can view perfectly and refuse to
 * open: `unsplittable` (a MALFORMED `<body>` — unclosed, or closed before it
 * opens; a document with no `<body>` at all splits fine per ADR-0062
 * Amendment 4) and `unparsable` (the body defeats the schema parser)
 * are the two ways that happens, and they name the same two failures the read
 * path degrades on.
 *
 * `null` — modelled at the field, not in this enumeration — means UNKNOWN:
 * nobody ran the probe. Every version written before ADR-0080 is unknown, and
 * unknown is never treated as un-editable: the editor still attempts and
 * degrades.
 */
export const VERSION_EDITABILITY = ["editable", "unsplittable", "unparsable"] as const;
export type VersionEditability = (typeof VERSION_EDITABILITY)[number];

/**
 * Whether the editor would KEEP a version's bytes (ADR-0090) — the orthogonal
 * twin of `VersionEditability`, which says only whether it can OPEN them.
 *
 * `lossless` — a parse-then-serialise round trip through the Report HTML
 * schema loses no element and no attribute. `lossy` — it drops at least one:
 * the inline `<script>` and `<svg>` of a slide deck are the motivating case,
 * and that deck is `editable` + `lossy`, which is exactly why this is a
 * separate field and not a fourth editability value.
 *
 * `null` — modelled at the field, not in this enumeration — means UNKNOWN:
 * nobody ran the probe. That is every version written before ADR-0090, plus
 * every version whose editability is not `editable` (no round trip to run, so
 * no honest verdict). Unknown is never read as `lossless`, and nothing gates
 * on this: a lossy version stays fully editable.
 */
export const VERSION_FIDELITY = ["lossless", "lossy"] as const;
export type VersionFidelity = (typeof VERSION_FIDELITY)[number];
