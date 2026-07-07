// Declarative configuration for the docs-conformance harness.
//
// This file is intentionally the single place where the "rules" live, so the
// rules are themselves reviewable in a PR. Validators read from here; they
// hold no policy of their own. See docs/adr/0041 and PRD issue #13.

/** ADR (MADR) conformance rules. */
export const adr = {
  // Status vocabulary allowed in an ADR's `**Status**` field (INDEX.md may
  // append a date, e.g. "Accepted (2026-06-04)" — matched by startsWith).
  allowedStatuses: ["Proposed", "Accepted", "Rejected", "Deprecated", "Superseded by"],
  // Section headings every ADR must carry (case-insensitive substring match).
  // Calibrated against ADR-0035..0040 so existing records pass.
  requiredSections: [
    "Context and problem statement",
    "Decision drivers",
    "Decision outcome",
    "Considered options",
    "More information",
  ],
};

/** Ubiquitous-language rules (ADR-0036). */
export const glossary = {
  // Files excluded from the banned-alias scan. The diary is a chronological
  // log that legitimately quotes superseded terms when recording renames.
  scanExclude: ["docs/diary.md"],
  // Banned aliases → canonical term. `re` is matched per line; lines that
  // document the ban itself (containing "_Avoid_" / "Avoid:") are skipped.
  bannedAliases: [
    {
      term: "Version",
      canonical: "ReportVersion",
      // Standalone capitalised "Version" — not part of "ReportVersion",
      // "version_no", a hyphenated slug, etc.
      re: /(?<![\w-])Version(?![\w-])/,
      hint: 'A snapshot of a report\'s content is a "ReportVersion" (glossary).',
    },
  ],
};

/** Canonical domain events (docs/events.md is the registry). */
export const events = [
  "ReportVersionUploaded",
  "ReportPublished",
  "AclChanged",
  "CollaboratorGranted",
  "UserCreated",
  "ApiKeyUsed",
  "ApiKeyAnomalyDetected",
  "ReportVersionScanned",
  "AbuseReported",
  "ReportTakenDown",
  "CspViolationReported",
  "CommentAdded",
  "CommentResolved",
];

/** Gherkin tag vocabulary. Every .feature must carry exactly one phase tag. */
export const featureTags = {
  phases: ["@phase-1", "@phase-1.5", "@phase-2", "@phase-2.5", "@phase-3", "@phase-4"],
  extra: ["@wip", "@security"],
};

/**
 * The use-case catalog. feature-presence enforces a bijection between these
 * slugs and tests/e2e/features/<slug>.feature. `status: 'full'` use-cases have
 * worked scenarios; `'wip'` are honest skeletons for a later phase.
 */
export const features = {
  // ── Phase 1: core upload + viewer ────────────────────────────────────
  "upload-report-via-api": {
    title: "Upload a report via the HTTP API",
    phase: "@phase-1",
    status: "full",
  },
  "re-upload-keeps-url-stable": {
    title: "Re-upload keeps the slug stable",
    phase: "@phase-1",
    status: "full",
  },
  "upload-report-via-web": {
    title: "Upload a report from the web UI",
    phase: "@phase-1",
    status: "full",
  },
  "view-published-report": { title: "View a published report", phase: "@phase-1", status: "full" },
  "view-report-while-scanning": {
    title: "View a report that is still scanning",
    phase: "@phase-1",
    status: "full",
  },
  "view-version-by-ordinal": {
    title: "View a specific version with ?v=N",
    phase: "@phase-1",
    status: "full",
  },
  "upload-guardrails": { title: "Upload pre-check guardrails", phase: "@phase-1", status: "full" },
  "reject-svg-upload": { title: "Reject SVG uploads", phase: "@phase-1", status: "full" },
  "idempotent-write-api": { title: "Idempotent write API", phase: "@phase-1", status: "full" },
  "enforce-plan-limits": {
    title: "Enforce plan limits on upload",
    phase: "@phase-1",
    status: "full",
  },
  "enforce-api-key-scopes": { title: "Enforce API key scopes", phase: "@phase-1", status: "full" },
  "viewer-origin-isolation": {
    title: "Viewer origin isolation",
    phase: "@phase-1",
    status: "full",
  },
  "block-service-worker": {
    title: "Block service-worker registration",
    phase: "@phase-1",
    status: "full",
  },
  "viewer-security-headers": {
    title: "Viewer security-header stack",
    phase: "@phase-1",
    status: "full",
  },
  "problem-json-error-model": {
    title: "RFC 9457 problem+json error model",
    phase: "@phase-1",
    status: "full",
  },
  "sign-up-and-switch-orgs": {
    title: "Sign up and switch organizations",
    phase: "@phase-1",
    status: "full",
  },
  "audit-log-every-action": {
    title: "Audit-log every mutating action",
    phase: "@phase-1",
    status: "full",
  },
  // ── Phase 1.5: scanning + abuse ──────────────────────────────────────
  "report-flagged-unavailable": {
    title: "Flagged report is unavailable (451)",
    phase: "@phase-1.5",
    status: "wip",
  },
  "report-taken-down": {
    title: "Taken-down report is gone (410)",
    phase: "@phase-1.5",
    status: "wip",
  },
  "malware-scan-eicar": { title: "Malware scan blocks EICAR", phase: "@phase-1.5", status: "wip" },
  "submit-abuse-report": { title: "Submit an abuse report", phase: "@phase-1.5", status: "wip" },
  "enforce-rate-limits": { title: "Enforce rate limits", phase: "@phase-1.5", status: "wip" },
  // ── Phase 2 / 2.5: sharing + collaboration ───────────────────────────
  "sharing-modes": { title: "Sharing modes gate access", phase: "@phase-2", status: "wip" },
  "organize-reports-in-folders": {
    title: "Organize reports in folders",
    phase: "@phase-2",
    status: "wip",
  },
  "list-report-versions": {
    title: "List a report's version history",
    phase: "@phase-2",
    status: "wip",
  },
  "cross-org-collaboration": {
    title: "Cross-org collaboration via grants",
    phase: "@phase-2.5",
    status: "wip",
  },
  // ── Phase 3 / 4: clients + polish ────────────────────────────────────
  "upload-report-via-mcp": { title: "Upload a report via MCP", phase: "@phase-3", status: "wip" },
  "enforce-mfa": { title: "Enforce MFA for admins", phase: "@phase-4", status: "wip" },
  "detect-api-key-anomaly": {
    title: "Detect API-key usage anomalies",
    phase: "@phase-4",
    status: "wip",
  },
  "trusted-types-dashboard": {
    title: "Trusted Types on the dashboard",
    phase: "@phase-1",
    status: "wip",
  },
};

/** OpenAPI structural assertions (lint-lite; full Spectral lint is deferred). */
export const openapi = {
  mustContain: [
    "openapi: 3.1",
    "/api/v1/reports",
    "Idempotency-Key",
    "application/problem+json",
    // ADR-0040 status mapping + the success code (quoted YAML response keys).
    "'201'",
    "'401'",
    "'402'",
    "'403'",
    "'404'",
    "'409'",
    "'413'",
    "'415'",
    "'422'",
    "'429'",
    "'500'",
    // Stable machine-readable `code` registry (ADR-0040).
    "unauthenticated",
    "forbidden",
    "not_found",
    "unsupported_media_type",
    "payload_too_large",
    "validation_error",
    "idempotency_key_reuse",
    "idempotency_in_flight",
    "plan_limit_exceeded",
    "rate_limited",
    "internal_error",
  ],
  hints: {
    "application/problem+json": "Error responses use RFC 9457 problem+json (ADR-0040).",
    "Idempotency-Key": "Document the Idempotency-Key request header (ADR-0039).",
    "'402'": "PlanLimitExceeded maps to 402, distinct from 429 (ADR-0040).",
  },
};

export default { adr, glossary, events, featureTags, features, openapi };
