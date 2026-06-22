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

export interface ReportPage {
  readonly reports: readonly Record<string, unknown>[];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
}

export interface FolderList {
  readonly folders: readonly Record<string, unknown>[];
}

export interface ApiClientConfig {
  /** Origin of the API, e.g. https://app.agranado.com. */
  readonly baseUrl: string;
  /** The caller's `Authorization` header, forwarded verbatim (or null = anonymous). */
  readonly authorization: string | null;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export interface SearchReportsParams {
  readonly q?: string;
  readonly folderId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export class ApiClient {
  constructor(private readonly cfg: ApiClientConfig) {}

  searchReports(params: SearchReportsParams): Promise<ApiResult<ReportPage>> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.folderId) qs.set("folder_id", params.folderId);
    if (params.page !== undefined) qs.set("page", String(params.page));
    if (params.pageSize !== undefined) qs.set("page_size", String(params.pageSize));
    const query = qs.toString();
    return this.get<ReportPage>(`/api/v1/reports${query ? `?${query}` : ""}`);
  }

  listFolders(): Promise<ApiResult<FolderList>> {
    return this.get<FolderList>("/api/v1/folders");
  }

  private async get<T>(path: string): Promise<ApiResult<T>> {
    const doFetch = this.cfg.fetch ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.cfg.authorization) headers.authorization = this.cfg.authorization;

    let res: Response;
    try {
      res = await doFetch(`${this.cfg.baseUrl}${path}`, { headers });
    } catch (e) {
      return {
        ok: false,
        problem: { title: "Network error reaching the API", status: 502, detail: String(e) },
      };
    }
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<ApiResult<T>> {
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
