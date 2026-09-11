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
import type { AppError, Result, VersionEditability, VersionFidelity, VersionId } from "arp-domain";
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
  /** THIS version's Editability (ADR-0080); `null` = never probed. */
  readonly editability: VersionEditability | null;
  /** THIS version's Fidelity (ADR-0090); `null` = never probed. */
  readonly fidelity: VersionFidelity | null;
}

export function reportContentToHttp(
  result: Result<ReportContentOutcome, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { slug, versionId, versionNo, contentType, html, source, editability, fidelity } =
    result.value;
  const body: ReportContentWire = {
    object: "report_content" as const,
    slug,
    version_id: versionIdToWire(versionId),
    version_no: versionNo,
    content_type: contentType,
    html,
    ...(source !== undefined ? { source } : {}),
    // ADR-0080 — the open-time verdict, beside the retention one below. The
    // content read carried fidelity without it, so a consumer could learn that
    // a save would be lossy but not that the editor cannot open the document.
    editability,
    // ADR-0090 — emitted as `null` when never probed, never omitted: unlike
    // `source`, whose absence is itself the answer, a missing key here would
    // collapse UNKNOWN into `lossless`.
    fidelity,
    mode: ctx.mode,
  };
  return { status: 200, contentType: "application/json", body };
}
