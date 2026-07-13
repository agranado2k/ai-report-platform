// Wire (snake_case) shapes returned by the app-origin REST API's `/comments`,
// `/versions`, and `/diff` endpoints (ADR-0053 resources, ADR-0063 edit-token
// API acceptance seam) — the unified-experience epic's Comments / Versions /
// Compare tabs. Mirrors `packages/http/src/resource.ts`'s `commentBody`/
// `versionBody` and `packages/http/src/diff-response.ts`'s body exactly
// (this is the CLIENT'S view of those types, not a re-declaration owned by
// this app — kept in sync by hand since the client can't import the app's
// server-only `arp-http` response mappers across the origin boundary).

/** The Stripe-style list envelope every list endpoint returns (ADR-0053). */
export interface ListEnvelope<T> {
  readonly object: "list";
  readonly data: readonly T[];
  readonly has_more: boolean;
}

/** A `comment` resource (ADR-0064). `anchor.relative`, when present, is the
 *  SAME opaque shape `arp-editor`'s `CommentForHighlight` expects — a
 *  `CommentWire` is directly assignable to it (both carry `id` +
 *  `anchor.relative`), no mapping needed for highlight decorations. */
export interface CommentWire {
  readonly object: "comment";
  readonly id: string;
  readonly report_id: string;
  readonly author_id: string;
  /** The author's resolvable identity (ADR-0063 author display). `id` mirrors
   *  `author_id`; `name` is the human display name when stored (else null);
   *  `email` is the fallback identity, null for a deleted/never-mirrored user.
   *  `author` is optional here defensively (additive — a pre-ADR-0063 server may
   *  omit it); `name` is likewise optional (a server predating display names). */
  readonly author?: {
    readonly id: string;
    readonly email: string | null;
    readonly name?: string | null;
  };
  readonly parent_id: string | null;
  readonly body: string;
  /** What the author wants done with the comment (ADR-0064 Decision 8):
   *  `note` | `enhancement` | `add` | `remove`. Defaults to `note`. */
  readonly intent: string;
  readonly anchor: {
    readonly version_pinned: { readonly version_id: string; readonly text_quote: string };
    readonly relative?: unknown;
  };
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly mode: string;
}

/** A `version` resource (ADR-0065). */
export interface VersionWire {
  readonly object: "version";
  readonly id: string;
  readonly version_no: number;
  readonly uploaded_by: string;
  /** The uploader's resolvable identity (ADR-0063 author display). `id` mirrors
   *  `uploaded_by`; `name` is the human display name when stored (else null);
   *  `email` is the fallback, null for a deleted/never-mirrored user. `author` is
   *  optional defensively (additive); `name` likewise (a pre-display-name server). */
  readonly author?: {
    readonly id: string;
    readonly email: string | null;
    readonly name?: string | null;
  };
  readonly uploaded_at: string;
  readonly scan_status: string;
  readonly size_bytes: number;
  readonly origin: string;
  readonly mode: string;
}

/** A `report_diff` resource (ADR-0065 §3/§4). `html` is a BODY FRAGMENT
 *  (already-sanitized markup derived from `reportSchema`/the fallback
 *  block-diff — never a full document) — the caller must reinject it into
 *  the report's own shell (`reinjectShell`, arp-report-html) and render the
 *  result through `buildReadOnlyIframeDocument`'s sandboxed `srcDoc`, per
 *  F-1. Never render via `dangerouslySetInnerHTML`. */
export interface DiffWire {
  readonly object: "report_diff";
  readonly diff_mode: "structural" | "fallback";
  readonly html: string;
  readonly label: string | null;
  readonly from: { readonly id: string; readonly version_no: number };
  readonly to: { readonly id: string; readonly version_no: number };
  readonly mode: string;
}
