// Thin REST client over the report platform's `/api/v1` (ADR-003: the MCP server
// owns no business logic — it forwards the caller's `arp_` Bearer to the live API
// and maps the response). Tool handlers call these methods; the Express transport
// constructs one per request, bound to that request's Authorization header.
//
// Errors come back as RFC-9457 `application/problem+json` (ADR-0040); we surface
// them as a structured `Problem` so a tool can render an actionable message to the
// model. Injectable `fetch` keeps this unit-testable without a live API.

import type {
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
   *  (`owner` always present; `acl` only when the caller is the owner); 404 → problem. */
  getReport(slug: string): Promise<ApiResult<ReportDetailWire>> {
    return this.get<ReportDetailWire>(`/api/v1/reports/${encodeURIComponent(slug)}`);
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

  /** Read a report's sharing acl — `{ object: "acl", mode, allowed_emails?, access_ttl_seconds? }`. */
  getReportAcl(slug: string): Promise<ApiResult<AclWire>> {
    return this.get<AclWire>(`/api/v1/reports/${encodeURIComponent(slug)}/acl`);
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

  private async request<T>(
    method: string,
    path: string,
    body?: { readonly json?: unknown; readonly form?: FormData },
  ): Promise<ApiResult<T>> {
    const doFetch = this.cfg.fetch ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.cfg.authorization) headers.authorization = this.cfg.authorization;

    let payload: BodyInit | undefined;
    if (body?.json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body?.form) {
      // Do NOT set content-type — fetch adds multipart/form-data + the boundary.
      payload = body.form;
    }

    let res: Response;
    try {
      res = await doFetch(`${this.cfg.baseUrl}${path}`, { method, headers, body: payload });
    } catch (e) {
      return {
        ok: false,
        problem: { title: "Network error reaching the API", status: 502, detail: String(e) },
      };
    }
    return this.parse<T>(res);
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
