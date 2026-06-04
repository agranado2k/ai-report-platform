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

export const ACL_MODES = ["public", "password", "org", "allowlist"] as const;
export type AclMode = (typeof ACL_MODES)[number];

export const GRANT_LEVELS = ["editor", "admin"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];
