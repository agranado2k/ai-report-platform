// HTTP response mapper for GET /api/v1/reports/{slug}/content (issue #312) —
// the authenticated/MCP read-back of a report VERSION's stored document. Pure:
// turns the content-loader's Result into the `report_content` resource or an
// application/problem+json error.
//
// `html` is the document as stored (served byte-for-byte, ADR-0038) and is
// UNTRUSTED content (ADR-0069) — a consumer treats it as DATA. `source` (the
// ADR-0062 §4 `_source.json` ProseMirror doc) is included ONLY when the loader
// resolved one; the key is OMITTED otherwise, never emitted as `null`, so a
// caller can tell "no sidecar" from "an empty doc".
import type { AppError, Result, VersionId } from "arp-domain";
import { versionIdToWire } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import type { WireContext } from "./resource";
import type { ReportContentWire } from "./wire";

export interface ReportContentOutcome {
  readonly slug: string;
  readonly versionId: VersionId;
  readonly versionNo: number;
  readonly contentType: string;
  readonly html: string;
  readonly source?: unknown;
}

export function reportContentToHttp(
  result: Result<ReportContentOutcome, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { slug, versionId, versionNo, contentType, html, source } = result.value;
  const body: ReportContentWire = {
    object: "report_content" as const,
    slug,
    version_id: versionIdToWire(versionId),
    version_no: versionNo,
    content_type: contentType,
    html,
    ...(source !== undefined ? { source } : {}),
    mode: ctx.mode,
  };
  return { status: 200, contentType: "application/json", body };
}
