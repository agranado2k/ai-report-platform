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
