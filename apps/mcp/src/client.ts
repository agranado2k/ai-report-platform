// Thin REST client over the report platform's `/api/v1` (ADR-003: the MCP server
// owns no business logic — it forwards the caller's `arp_` Bearer to the live API
// and maps the response). Tool handlers call these methods; the Express transport
// constructs one per request, bound to that request's Authorization header.
//
// Errors come back as RFC-9457 `application/problem+json` (ADR-0040); we surface
// them as a structured `Problem` so a tool can render an actionable message to the
// model. Injectable `fetch` keeps this unit-testable without a live API.

import { randomUUID } from "node:crypto";
import type {
  AclSharingWire,
  AclWire,
  CommentWire,
  FolderShareWire,
  FolderWire,
  ListEnvelope,
  ReportDetailWire,
  ReportSharingWire,
  ReportWire,
  SharingApplyWire,
  VersionWire,
  WriteGrantWire,
} from "arp-http/wire";

/** RFC-9457 problem detail (the subset the API emits, ADR-0040). */
export interface Problem {
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  /** Stable machine-readable code (e.g. `unauthenticated`, `validation_error`). */
  readonly code?: string;
  readonly type?: string;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly problem: Problem };

/** Cursor-pagination params (ADR-0053): the cursor is a prefixed id. Client-side
 *  option bag (camelCase); `appendCursor` renders it to the wire's snake_case
 *  query params (`arp-http/wire`'s `WireCursorParams`). */
export interface CursorParams {
  readonly limit?: number;
  readonly startingAfter?: string;
  readonly endingBefore?: string;
}

export interface ApiClientConfig {
  /** Origin of the API, e.g. https://app.centaurspec.com. */
  readonly baseUrl: string;
  /** The caller's `Authorization` header, forwarded verbatim (or null = anonymous). */
  readonly authorization: string | null;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  /** Injectable for tests so backoff does not make the suite sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface SearchReportsParams extends CursorParams {
  readonly q?: string;
  readonly folderId?: string;
}

/** Append the cursor params (snake_case on the wire) to a query string. */
function appendCursor(qs: URLSearchParams, p: CursorParams): void {
  if (p.limit !== undefined) qs.set("limit", String(p.limit));
  if (p.startingAfter) qs.set("starting_after", p.startingAfter);
  if (p.endingBefore) qs.set("ending_before", p.endingBefore);
}

/** Bounded: two retries after the first try. Enough to ride out a redeploy or a
 *  dropped connection; small enough that a genuinely down API fails fast. */
const MAX_ATTEMPTS = 3;
/** Transients only — never a CLIENT-FAULT 4xx. (408 and 429 are 4xx but are
 *  about timing, not about the request being wrong.) */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/**
 * `IdempotencyInFlight`. Retryable ONLY because we back off first.
 *
 * `beginIdempotentWrite` claims the key BEFORE the mutation's transaction, and
 * that INSERT autocommits — so a first attempt that reached the server and then
 * failed leaves an `in_flight` row behind. Retrying with no delay therefore
 * answers 409 "request in flight" and BURIES the real error. With a delay the
 * first attempt has usually settled, and the retry gets what it came for: the
 * recorded response, replayed.
 */
const IN_FLIGHT_STATUS = 409;
/** Backoff base; attempt N waits ~BASE * 2^(N-1) with jitter. */
const BASE_RETRY_DELAY_MS = 250;
/** Never wait longer than this for a `Retry-After`, so a throttled call still
 *  returns inside an agent's tool-call budget instead of hanging. */
const MAX_RETRY_DELAY_MS = 5_000;

export class ApiClient {
  constructor(private readonly cfg: ApiClientConfig) {}

  searchReports(params: SearchReportsParams): Promise<ApiResult<ListEnvelope<ReportWire>>> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.folderId) qs.set("folder_id", params.folderId);
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope<ReportWire>>(`/api/v1/reports${query ? `?${query}` : ""}`);
  }

  /** Fetch a single report by slug or report_ id — the single-report resource
   *  (`owner` always present; `acl` only when the caller is the owner; `sharing`
   *  always, ADR-0078 §13); 404 → problem. */
  getReport(slug: string): Promise<ApiResult<ReportSharingWire>> {
    return this.get<ReportSharingWire>(`/api/v1/reports/${encodeURIComponent(slug)}`);
  }

  listFolders(params: CursorParams = {}): Promise<ApiResult<ListEnvelope<FolderWire>>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope<FolderWire>>(`/api/v1/folders${query ? `?${query}` : ""}`);
  }

  /** Create a report, or re-upload a new version of `updateSlug` (multipart, ADR-0037). */
  uploadReport(params: {
    readonly html: string;
    readonly updateSlug?: string;
    readonly folderPath?: string;
  }): Promise<ApiResult<unknown>> {
    const form = new FormData();
    // `file` is the only required part; the API derives the Idempotency-Key from
    // the content when the header is absent (ADR-0039), giving content-dedup for
    // free — so we deliberately don't send one.
    form.append("file", new File([params.html], "index.html", { type: "text/html" }));
    if (params.updateSlug) form.append("update_slug", params.updateSlug);
    if (params.folderPath) form.append("folder_path", params.folderPath);
    return this.request<unknown>("POST", "/api/v1/reports", { form });
  }

  renameReport(slug: string, title: string): Promise<ApiResult<ReportDetailWire>> {
    return this.request<ReportDetailWire>("PATCH", `/api/v1/reports/${encodeURIComponent(slug)}`, {
      json: { title },
    });
  }

  moveReport(slug: string, folderId: string): Promise<ApiResult<ReportDetailWire>> {
    return this.request<ReportDetailWire>(
      "POST",
      `/api/v1/reports/${encodeURIComponent(slug)}/move`,
      {
        json: { folder_id: folderId },
      },
    );
  }

  deleteReport(slug: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("DELETE", `/api/v1/reports/${encodeURIComponent(slug)}`);
  }

  /** List a report's version history (ADR-0065) — cursor-paginated, newest-created
   *  first; each item has id (version_…), version_no, uploaded_by (user_…),
   *  uploaded_at, scan_status, size_bytes, origin. */
  listReportVersions(
    slug: string,
    params: CursorParams = {},
  ): Promise<ApiResult<ListEnvelope<VersionWire>>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope<VersionWire>>(
      `/api/v1/reports/${encodeURIComponent(slug)}/versions${query ? `?${query}` : ""}`,
    );
  }

  /** Read a report's sharing acl PLUS its composed three-state `sharing`
   *  (ADR-0078 §13) — `{ object: "acl", mode, allowed_emails?,
   *  access_ttl_seconds?, sharing }`. Both are needed: `mode: "org"` is
   *  identical for `org_view` and `org_edit`. */
  getReportAcl(slug: string): Promise<ApiResult<AclSharingWire>> {
    return this.get<AclSharingWire>(`/api/v1/reports/${encodeURIComponent(slug)}/acl`);
  }

  /** Set a report's sharing acl (ADR-0056). Sends only the fields relevant to `mode`. */
  setReportAcl(
    slug: string,
    params: {
      readonly mode: string;
      readonly allowedEmails?: readonly string[];
      readonly password?: string;
      readonly accessTtlSeconds?: number;
    },
  ): Promise<ApiResult<ReportDetailWire>> {
    return this.request<ReportDetailWire>(
      "POST",
      `/api/v1/reports/${encodeURIComponent(slug)}/acl`,
      {
        json: {
          mode: params.mode,
          ...(params.allowedEmails ? { allowed_emails: params.allowedEmails } : {}),
          // `!== undefined`, not truthiness — forward an explicit empty password so the server
          // returns a clear "password required" rather than a generic error (claude-review #118).
          ...(params.password !== undefined ? { password: params.password } : {}),
          ...(params.accessTtlSeconds !== undefined
            ? { access_ttl_seconds: params.accessTtlSeconds }
            : {}),
        },
      },
    );
  }

  /** Set a report's three-state sharing (ADR-0078): `private` / `org_view` /
   *  `org_edit`. Owner-only; requires the `acl:write` scope. `confirmDiscard`
   *  is forwarded ONLY when the caller passed it — the server refuses to leave
   *  `password`/`allowlist`/`public` without it, and defaulting it here would
   *  quietly remove that protection for every MCP caller. */
  setReportSharing(
    slug: string,
    params: { readonly sharing: string; readonly confirmDiscard?: boolean },
  ): Promise<ApiResult<ReportSharingWire>> {
    return this.request<ReportSharingWire>(
      "POST",
      `/api/v1/reports/${encodeURIComponent(slug)}/sharing`,
      {
        json: {
          sharing: params.sharing,
          ...(params.confirmDiscard === true ? { confirm_discard: true } : {}),
        },
      },
    );
  }

  /** Apply a sharing state to the reports INSIDE a folder (ADR-0078). Returns
   *  the per-report outcome — `changed`, `skipped` (with reasons) and
   *  `failed` — never a bare success. */
  applyFolderSharingToReports(id: string, sharing: string): Promise<ApiResult<SharingApplyWire>> {
    return this.request<SharingApplyWire>(
      "POST",
      `/api/v1/folders/${encodeURIComponent(id)}/reports/sharing`,
      { json: { sharing } },
      // NOT retried. This route deliberately ignores `Idempotency-Key`
      // (ADR-0078 §10): it is a LOOP of individually idempotent-in-effect state
      // sets, and a replayed summary would describe a run whose per-report
      // outcomes no longer match reality. Re-running it leaves the END STATE
      // correct but reports every report changed on the first attempt as
      // `skipped` ("already at the destination") — so the agent is told
      // `changed: []` for a run that changed N — and writes a second audit row
      // per re-applied report. It is also the slowest write in the API (up to
      // 50 sequential per-report transactions), which makes it the endpoint
      // MOST likely to draw a 504 and be retried.
      { retry: false },
    );
  }

  /** Grant write access (rename/re-upload/move) on a report to someone by email
   *  (ADR-0060). Owner-only; requires the `acl:write` scope. */
  grantWrite(slug: string, email: string): Promise<ApiResult<WriteGrantWire>> {
    return this.request<WriteGrantWire>(
      "POST",
      `/api/v1/reports/${encodeURIComponent(slug)}/write-grants`,
      { json: { email } },
    );
  }

  /** Revoke a write grant (idempotent — succeeds even if the grantee never had one). */
  revokeWrite(slug: string, email: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>(
      "DELETE",
      `/api/v1/reports/${encodeURIComponent(slug)}/write-grants/${encodeURIComponent(email)}`,
    );
  }

  /** List everyone with write access on a report (owner-only). */
  listWriteGrants(slug: string): Promise<ApiResult<ListEnvelope<WriteGrantWire>>> {
    return this.get<ListEnvelope<WriteGrantWire>>(
      `/api/v1/reports/${encodeURIComponent(slug)}/write-grants`,
    );
  }

  /** List a report's comments (ADR-0064) — cursor-paginated (ADR-0053),
   *  newest-created first; each item is a comment resource with id (comment_…),
   *  report_id, author_id (user_…), parent_id (comment_… for a reply, else null),
   *  body, anchor { version_pinned: { version_id, text_quote } }, resolved_at,
   *  created_at. Auth mirrors listReportVersions (org-scoped read). */
  listComments(
    slug: string,
    params: CursorParams = {},
  ): Promise<ApiResult<ListEnvelope<CommentWire>>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope<CommentWire>>(
      `/api/v1/reports/${encodeURIComponent(slug)}/comments${query ? `?${query}` : ""}`,
    );
  }

  /** Create a root comment on a report, OR (when `parentCommentId` is set) a reply
   *  to an existing one (ADR-0064). canWrite-gated; returns the created comment
   *  resource (201). The anchor pins the comment to a specific ReportVersion +
   *  quoted text; `relative` is forwarded opaquely (the editor slice interprets it). */
  addComment(
    slug: string,
    params: {
      readonly body: string;
      readonly versionId: string;
      readonly textQuote: string;
      readonly relative?: unknown;
      readonly parentCommentId?: string;
    },
  ): Promise<ApiResult<CommentWire>> {
    return this.request<CommentWire>(
      "POST",
      `/api/v1/reports/${encodeURIComponent(slug)}/comments`,
      {
        json: {
          body: params.body,
          anchor: {
            version_pinned: { version_id: params.versionId, text_quote: params.textQuote },
            ...(params.relative !== undefined ? { relative: params.relative } : {}),
          },
          ...(params.parentCommentId !== undefined
            ? { parent_comment_id: params.parentCommentId }
            : {}),
        },
      },
    );
  }

  /** Resolve a comment (ADR-0064) — PATCH with no body; returns the resolved
   *  comment resource (resolved_at set). Author-or-report-owner gated. One-way
   *  and idempotent: there is only one resolved transition (no un-resolve). */
  resolveComment(slug: string, commentId: string): Promise<ApiResult<CommentWire>> {
    return this.request<CommentWire>(
      "PATCH",
      `/api/v1/reports/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}`,
    );
  }

  /** Edit a comment's body and/or intent (ADR-0064 §3) — PATCH carrying the
   *  changed fields; returns the updated comment resource (200). Author-or-report-
   *  owner gated (the same rule as resolve/delete). At least one of body/intent
   *  must be supplied. */
  editComment(
    slug: string,
    commentId: string,
    params: { readonly body?: string; readonly intent?: string },
  ): Promise<ApiResult<CommentWire>> {
    return this.request<CommentWire>(
      "PATCH",
      `/api/v1/reports/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}`,
      {
        json: {
          ...(params.body !== undefined ? { body: params.body } : {}),
          ...(params.intent !== undefined ? { intent: params.intent } : {}),
        },
      },
    );
  }

  /** Delete a comment (ADR-0064) — 204 no content. Author-or-report-owner gated. */
  deleteComment(slug: string, commentId: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>(
      "DELETE",
      `/api/v1/reports/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}`,
    );
  }

  createFolder(params: {
    readonly name: string;
    readonly parentId: string;
  }): Promise<ApiResult<unknown>> {
    return this.request<unknown>("POST", "/api/v1/folders", {
      json: { name: params.name, parent_id: params.parentId },
    });
  }

  renameFolder(id: string, name: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("PATCH", `/api/v1/folders/${encodeURIComponent(id)}`, {
      json: { name },
    });
  }

  deleteFolder(id: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("DELETE", `/api/v1/folders/${encodeURIComponent(id)}`);
  }

  /** Set a folder's visibility (ADR-0076): `private` (owner + shares) or `org`
   *  (every member). Owner-or-legacy only; requires the `acl:write` scope. A
   *  legacy (owner-less) folder is ADOPTED by the caller. */
  setFolderVisibility(id: string, visibility: string): Promise<ApiResult<FolderWire>> {
    return this.request<FolderWire>(
      "POST",
      `/api/v1/folders/${encodeURIComponent(id)}/visibility`,
      { json: { visibility } },
    );
  }

  /** Share a folder's VISIBILITY with someone by email (ADR-0076 — never write).
   *  Owner-or-legacy only; requires the `acl:write` scope. */
  shareFolder(id: string, email: string): Promise<ApiResult<FolderShareWire>> {
    return this.request<FolderShareWire>(
      "POST",
      `/api/v1/folders/${encodeURIComponent(id)}/shares`,
      { json: { email } },
    );
  }

  /** Revoke a folder share (idempotent — succeeds even if none existed). */
  unshareFolder(id: string, email: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>(
      "DELETE",
      `/api/v1/folders/${encodeURIComponent(id)}/shares/${encodeURIComponent(email)}`,
    );
  }

  /** List everyone a folder is shared with (owner-or-legacy only). */
  listFolderShares(id: string): Promise<ApiResult<ListEnvelope<FolderShareWire>>> {
    return this.get<ListEnvelope<FolderShareWire>>(
      `/api/v1/folders/${encodeURIComponent(id)}/shares`,
    );
  }

  private get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>("GET", path);
  }

  /** Wall-clock pause between retry attempts; injectable so tests stay fast. */
  private pause(ms: number): Promise<void> {
    const sleep = this.cfg.sleep ?? ((d: number) => new Promise<void>((r) => setTimeout(r, d)));
    return sleep(ms);
  }

  /** How long to wait before the next attempt: the server's `Retry-After` when
   *  it sent one (capped), else exponential backoff with jitter so a fleet of
   *  agents retrying the same failure does not resonate. */
  private retryDelayMs(attempt: number, res?: Response): number {
    const header = res?.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now(); // HTTP-date form
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_DELAY_MS);
    }
    const backoff = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
    return Math.min(backoff + Math.random() * BASE_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: { readonly json?: unknown; readonly form?: FormData },
    opts?: { readonly retry?: boolean },
  ): Promise<ApiResult<T>> {
    const doFetch = this.cfg.fetch ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.cfg.authorization) headers.authorization = this.cfg.authorization;

    // ADR-0039 + its 2026-08-07 amendment (issue #233). The server no longer
    // DERIVES a key for state-setting writes — a key derived from the payload
    // replays A -> B -> A and lets a pre-emptive delete burn the real one — so
    // the only exactly-once retry semantics available are the ones a client
    // asks for. This client previously asked for none, which meant a retried
    // DELETE returned 404 for a call that had succeeded.
    //
    // Minted ONCE, here, and reused by every attempt below. It identifies this
    // ATTEMPT, not the payload: two genuinely separate calls with identical
    // bodies get different keys, which is exactly the property that makes this
    // safe rather than a client-side reconstruction of the removed bug.
    // NOT on multipart uploads. `uploadReport` deliberately sends no key so the
    // server derives one from the CONTENT (ADR-0039), which gives content-dedup
    // for free — upload is one of the `sound` operations where the derived key
    // is the guarantee, not a hazard. Minting a random key here would replace
    // that dedup with "every retry creates another version", which is the
    // opposite of what this change is for.
    if (method !== "GET" && method !== "HEAD" && !body?.form) {
      headers["idempotency-key"] = randomUUID();
    }

    let payload: BodyInit | undefined;
    if (body?.json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body?.form) {
      // Do NOT set content-type — fetch adds multipart/form-data + the boundary.
      payload = body.form;
    }

    // A FormData body is a one-shot stream in some runtimes, so replaying it is
    // not guaranteed safe — uploads keep the old single-attempt behaviour.
    const attempts = body?.form || opts?.retry === false ? 1 : MAX_ATTEMPTS;
    const idempotent = headers["idempotency-key"] !== undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await doFetch(`${this.cfg.baseUrl}${path}`, { method, headers, body: payload });
        // Retry only what a retry can fix: transport-level and server-side
        // transients, plus an in-flight collision with our OWN first attempt.
        // Any other 4xx is the caller's request being wrong; repeating it only
        // burns the key.
        const retryable =
          RETRYABLE_STATUS.has(res.status) || (idempotent && res.status === IN_FLIGHT_STATUS);
        if (!retryable || attempt === attempts) return this.parse<T>(res);
        // Release the socket: an unread body keeps the connection checked out,
        // and this client runs inside a long-lived process (ADR-0051).
        await res.body?.cancel().catch(() => undefined);
        await this.pause(this.retryDelayMs(attempt, res));
      } catch (e) {
        lastError = e;
        if (attempt === attempts) break;
        await this.pause(this.retryDelayMs(attempt));
      }
    }

    return {
      ok: false,
      problem: {
        title: "Network error reaching the API",
        status: 502,
        detail: String(lastError ?? "request failed after retries"),
      },
    };
  }

  private async parse<T>(res: Response): Promise<ApiResult<T>> {
    // 204 No Content (e.g. DELETE) has no body to parse.
    if (res.status === 204) return { ok: true, data: undefined as T };
    if (res.ok) return { ok: true, data: (await res.json()) as T };

    // Try to read the API's RFC-9457 body; fall back to a synthetic problem.
    let problem: Problem = { title: `HTTP ${res.status}`, status: res.status };
    try {
      const body = (await res.json()) as Partial<Problem>;
      problem = {
        title: body.title ?? problem.title,
        status: typeof body.status === "number" ? body.status : res.status,
        detail: body.detail,
        code: body.code,
        type: body.type,
      };
    } catch {
      // non-JSON error body → keep the synthetic problem
    }
    return { ok: false, problem };
  }
}
