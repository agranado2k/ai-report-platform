// HTTP response mapper for POST /api/v1/reports/{slug}/edit-token (ADR-0063
// Phase 5) — the silent-refresh endpoint's wire shape. Pure — turns the
// refresh helper's Result into the `edit_token` resource or an
// application/problem+json error. No `WireContext` needed: unlike every
// other resource on this API, a refreshed edit token carries no prefixed
// External Id and no deployment `mode` — it's a bearer capability, not an
// addressable object.
import type { AppError, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";

/** The refreshed capability. Mirrors edit-token-refresh.server.ts's
 *  `RefreshedEditToken` return shape structurally (this package stays free
 *  of any apps/app import, ADR-024-style layering — the server module's
 *  result is duck-typed against this interface at the call site, the same
 *  pattern diff-response.ts's `ReportDiffOutcome` uses for
 *  report-diff-loader.server.ts's `LoadedReportDiff`). */
export interface RefreshedEditToken {
  readonly editToken: string;
  /** epoch seconds. */
  readonly expiresAt: number;
}

export function refreshEditTokenToHttp(result: Result<RefreshedEditToken, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: {
      object: "edit_token" as const,
      edit_token: result.value.editToken,
      expires_at: result.value.expiresAt,
    },
  };
}
