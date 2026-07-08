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
