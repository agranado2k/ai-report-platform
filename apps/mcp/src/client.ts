// Thin REST client over the report platform's `/api/v1` (ADR-003: the MCP server
// owns no business logic — it forwards the caller's `arp_` Bearer to the live API
// and maps the response). Tool handlers call these methods; the Express transport
// constructs one per request, bound to that request's Authorization header.
//
// Errors come back as RFC-9457 `application/problem+json` (ADR-0040); we surface
// them as a structured `Problem` so a tool can render an actionable message to the
// model. Injectable `fetch` keeps this unit-testable without a live API.

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

/** The Stripe-style list envelope (ADR-0053): `{ object: "list", data, has_more }`. */
export interface ListEnvelope {
  readonly object: "list";
  readonly data: readonly Record<string, unknown>[];
  readonly has_more: boolean;
}

/** Cursor-pagination params (ADR-0053): the cursor is a prefixed id. */
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

  searchReports(params: SearchReportsParams): Promise<ApiResult<ListEnvelope>> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.folderId) qs.set("folder_id", params.folderId);
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope>(`/api/v1/reports${query ? `?${query}` : ""}`);
  }

  /** Fetch a single report by slug or report_ id (summary shape); 404 → problem. */
  getReport(slug: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.get<Record<string, unknown>>(`/api/v1/reports/${encodeURIComponent(slug)}`);
  }

  listFolders(params: CursorParams = {}): Promise<ApiResult<ListEnvelope>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope>(`/api/v1/folders${query ? `?${query}` : ""}`);
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

  renameReport(slug: string, title: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("PATCH", `/api/v1/reports/${encodeURIComponent(slug)}`, {
      json: { title },
    });
  }

  moveReport(slug: string, folderId: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("POST", `/api/v1/reports/${encodeURIComponent(slug)}/move`, {
      json: { folder_id: folderId },
    });
  }

  deleteReport(slug: string): Promise<ApiResult<unknown>> {
    return this.request<unknown>("DELETE", `/api/v1/reports/${encodeURIComponent(slug)}`);
  }

  /** List a report's version history (ADR-0065) — cursor-paginated, newest-created
   *  first; each item has id (version_…), version_no, uploaded_by (user_…),
   *  uploaded_at, scan_status, size_bytes, origin. */
  listReportVersions(slug: string, params: CursorParams = {}): Promise<ApiResult<ListEnvelope>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope>(
      `/api/v1/reports/${encodeURIComponent(slug)}/versions${query ? `?${query}` : ""}`,
    );
  }

  /** Read a report's sharing acl — `{ object: "acl", mode, allowed_emails?, access_ttl_seconds? }`. */
  getReportAcl(slug: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.get<Record<string, unknown>>(`/api/v1/reports/${encodeURIComponent(slug)}/acl`);
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
  ): Promise<ApiResult<unknown>> {
    return this.request<unknown>("POST", `/api/v1/reports/${encodeURIComponent(slug)}/acl`, {
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
    });
  }

  /** Grant write access (rename/re-upload/move) on a report to someone by email
   *  (ADR-0060). Owner-only; requires the `acl:write` scope. */
  grantWrite(slug: string, email: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>(
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
  listWriteGrants(slug: string): Promise<ApiResult<ListEnvelope>> {
    return this.get<ListEnvelope>(`/api/v1/reports/${encodeURIComponent(slug)}/write-grants`);
  }

  /** List a report's comments (ADR-0064) — cursor-paginated (ADR-0053),
   *  newest-created first; each item is a comment resource with id (comment_…),
   *  report_id, author_id (user_…), parent_id (comment_… for a reply, else null),
   *  body, anchor { version_pinned: { version_id, text_quote } }, resolved_at,
   *  created_at. Auth mirrors listReportVersions (org-scoped read). */
  listComments(slug: string, params: CursorParams = {}): Promise<ApiResult<ListEnvelope>> {
    const qs = new URLSearchParams();
    appendCursor(qs, params);
    const query = qs.toString();
    return this.get<ListEnvelope>(
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
  ): Promise<ApiResult<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>(
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
  resolveComment(slug: string, commentId: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>(
      "PATCH",
      `/api/v1/reports/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}`,
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
