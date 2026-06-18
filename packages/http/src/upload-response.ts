// HTTP response mapper for POST /api/v1/reports (ADR-0040). Pure: turns the
// use-case Result into a wire response — 201 JSON on success, RFC 9457
// application/problem+json on error. The mapping lives ONLY here (the adapter
// boundary); the domain/application keep returning Result<T, AppError> (ADR-0024).
import type { UploadOutcome } from "arp-application";
import type { AppError, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";

export type { HttpResponse };

export interface UploadResponseOptions {
  /**
   * Origin the viewer is served from, e.g. "https://view.example" (no trailing
   * slash). The canonical viewer URL is `${viewBaseUrl}/${slug}` — the report is
   * served on the PSL-isolated view origin (ADR-002 / ADR-0038), never under an
   * `/r/` prefix on the app origin.
   */
  readonly viewBaseUrl: string;
}

export function uploadResultToHttp(
  result: Result<UploadOutcome, AppError>,
  opts: UploadResponseOptions,
): HttpResponse {
  if (result.ok) {
    const { slug, version, scanStatus } = result.value.result;
    const viewUrl = `${opts.viewBaseUrl}/${slug}`;
    return {
      status: 201,
      contentType: "application/json",
      body: { slug, view_url: viewUrl, version, scan_status: scanStatus },
      headers: { Location: viewUrl },
    };
  }

  // Errors render identically across every endpoint — delegate to the shared
  // RFC 9457 mapper (problem.ts).
  return errorToHttp(result.error);
}
