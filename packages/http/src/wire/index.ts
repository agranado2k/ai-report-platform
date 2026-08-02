// The client-safe wire catalog (`arp-http/wire`) — the ONE place the `/api/v1`
// success wire shapes are declared (ADR-0052 prefixed External Ids, ADR-0053
// object/list envelopes, ADR-0040 keeps errors as RFC 9457 problem+json —
// deliberately NOT re-modeled here; see problem.ts).
//
// BROWSER-SAFE BY CONSTRUCTION: this subpath contains ONLY type declarations
// and TYPE-ONLY imports from `arp-domain` (erased at build — a VALUE import
// from the arp-domain barrel would drag `node:crypto` into a browser bundle).
// Server-only concerns (encoders, mappers, WireContext) stay in the package
// root; anything importable from `arp-http/wire` must keep that property.
//
// Enum vocabularies (AclMode, Intent, ScanStatus, VersionOrigin) are IMPORTED
// from arp-domain, never re-declared (ADR-0036 "one name per concept"). The
// encoders in ../resource.ts, ../diff-response.ts, and ../write-response.ts
// are return-typed against these shapes, and src/wire/index.test.ts locks the
// emitted objects to them — so the catalog cannot drift from what the server
// actually sends.
import type { AclMode, Intent, ScanStatus, VersionOrigin } from "arp-domain";

/** Which deployment a resource belongs to (ADR-0053): the live product vs preview/dev. */
export type WireMode = "prod" | "dev";

/** The Stripe-style list envelope every list endpoint returns (ADR-0053). */
export interface ListEnvelope<T> {
  readonly object: "list";
  readonly data: readonly T[];
  readonly has_more: boolean;
}

/** Cursor-pagination query params as they appear ON THE WIRE (ADR-0053):
 *  `limit` 1..100 (default 20, clamped), `starting_after`/`ending_before` a
 *  prefixed id (mutually exclusive). snake_case — this is the query-string
 *  shape, not a client-side option bag. */
export interface WireCursorParams {
  readonly limit?: number;
  readonly starting_after?: string;
  readonly ending_before?: string;
}

/** An author/uploader's resolvable identity as serialized on `comment` and
 *  `version` resources (ADR-0063 author display). ALWAYS present on the wire —
 *  `email`/`name` are null when unresolved (deleted / never-mirrored user or no
 *  stored display name), but the object itself is never omitted. */
export interface WireAuthorRef {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

/** A `report` resource in its SUMMARY shape (list items, ADR-0053). Carries
 *  both handles (ADR-0052): the `report_…` addressing id and the capability
 *  `slug`. Single-report responses extend this — see `ReportDetailWire`. */
export interface ReportWire {
  readonly object: "report";
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly is_published: boolean;
  readonly folder_id: string;
  readonly mode: WireMode;
}

/** A report's share config as EMBEDDED on an owner-viewed report resource
 *  (ADR-0056/0059) — mode + the allowlist extras; no `object` discriminator.
 *  The argon2id password hash is never serialized. */
export type AclShareWire =
  | { readonly mode: Exclude<AclMode, "allowlist"> }
  | {
      readonly mode: "allowlist";
      readonly allowed_emails: readonly string[];
      readonly access_ttl_seconds: number;
    };

/** The standalone `acl` resource GET /reports/{slug}/acl returns (ADR-0053/0056).
 *  Same payload as `AclShareWire` plus the `object` discriminator; carries no
 *  prefixed ids and no `mode` deployment stamp. */
export type AclWire = { readonly object: "acl" } & AclShareWire;

/** A `report` resource in its SINGLE-REPORT shape (get/rename/move/set-acl):
 *  the summary plus `owner` (a `user_…` id, ADR-0059 §6) and — ONLY when the
 *  viewer is the owner — the `acl` share config (ADR-0059 §3). */
export type ReportDetailWire = ReportWire & {
  readonly owner: string;
  readonly acl?: AclShareWire;
};

/** A `folder` resource. `parent_id` links the tree (null at the root). */
export interface FolderWire {
  readonly object: "folder";
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parent_id: string | null;
  readonly mode: WireMode;
}

/** A `version` resource (ADR-0065) — the ReportVersion projection on the wire.
 *  Timestamps are ISO-8601 strings; `author` mirrors `uploaded_by` and is
 *  always present (see `WireAuthorRef`). */
export interface VersionWire {
  readonly object: "version";
  readonly id: string;
  readonly version_no: number;
  readonly uploaded_by: string;
  readonly author: WireAuthorRef;
  readonly uploaded_at: string;
  readonly scan_status: ScanStatus;
  readonly size_bytes: number;
  readonly origin: VersionOrigin;
  readonly mode: WireMode;
}

/** A comment's anchor on the wire (ADR-0064): pinned to a specific
 *  ReportVersion + the exact quoted text; `relative` is an opaque editor
 *  position payload, OMITTED when absent (the only optional field a resource
 *  encoder actually drops — see resource.ts's `commentBody`). */
export interface CommentAnchorWire {
  readonly version_pinned: {
    readonly version_id: string;
    readonly text_quote: string;
  };
  readonly relative?: unknown;
}

/** A `comment` resource (ADR-0064). `parent_id` is null for a root comment
 *  (starts a Thread), a `comment_…` id for a reply. `author` and `edited_at`
 *  are ALWAYS present (null-filled, never omitted) — resource.ts emits them
 *  unconditionally, so clients need no defensive optionality. `anchor.relative`,
 *  when present, is the same opaque shape arp-editor's `CommentForHighlight`
 *  expects — a CommentWire is directly assignable to it. */
export interface CommentWire {
  readonly object: "comment";
  readonly id: string;
  readonly report_id: string;
  readonly author_id: string;
  readonly author: WireAuthorRef;
  readonly parent_id: string | null;
  readonly body: string;
  /** What the author wants done with the comment (ADR-0064 Decision 8). */
  readonly intent: Intent;
  readonly anchor: CommentAnchorWire;
  /** When the comment was last edited (ISO-8601), or null if never edited —
   *  drives the "· edited" marker and doubles as the optimistic-concurrency
   *  token a client echoes back on its next edit (ADR-0064 §3). */
  readonly edited_at: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly mode: WireMode;
}

/** A `report_diff` resource (ADR-0065 §3/§4). `html` is a BODY FRAGMENT
 *  (already-sanitized markup derived from `reportSchema`/the fallback
 *  block-diff — never a full document) — the caller must reinject it into the
 *  report's own shell (`reinjectShell`, arp-report-html) and render the result
 *  through `buildReadOnlyIframeDocument`'s sandboxed `srcDoc`, per F-1. Never
 *  render via `dangerouslySetInnerHTML`. The diff's own fidelity axis is
 *  `diff_mode` — `mode` stays the ADR-0053 deployment stamp. */
export interface DiffWire {
  readonly object: "report_diff";
  readonly diff_mode: "structural" | "fallback";
  readonly html: string;
  readonly label: string | null;
  readonly from: { readonly id: string; readonly version_no: number };
  readonly to: { readonly id: string; readonly version_no: number };
  readonly mode: WireMode;
}

/** A `write_grant` resource (ADR-0060). Wire-addressed by `(slug, email)` — no
 *  surrogate id, and (unlike every other resource) no `mode` stamp. */
export interface WriteGrantWire {
  readonly object: "write_grant";
  readonly email: string;
  readonly granted_by: string;
  readonly granted_at: string;
  /** The grantee's one-click editor entry (`{appOrigin}/reports/{slug}/open` —
   *  the app's canWrite edit-token mint, ADR-0063). Present on the grant
   *  (create) response so the owner has a link to SEND the grantee — grants
   *  themselves stay silent (ADR-0060; no notification email). Additive:
   *  absent on list entries and older responses. */
  readonly open_url?: string;
}
