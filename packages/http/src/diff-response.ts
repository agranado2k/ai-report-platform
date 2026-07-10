// HTTP response mapper for GET /api/v1/reports/{slug}/diff (ADR-0063 API
// slice, ADR-0065 §3/§4). Pure — turns the diff-loader's Result into the
// `report_diff` resource or an application/problem+json error.
//
// WIRE-SHAPE NOTE: the diff's own structural/fallback decision is exposed as
// `diff_mode`, NOT `mode` — every other resource in this API carries `mode`
// to mean the DEPLOYMENT context (`ctx.mode`, "prod"/"dev", ADR-0053), and
// reusing that name here for a completely different axis (diff fidelity)
// would collide with that convention on the wire.
import type { AppError, Result, VersionId } from "arp-domain";
import { versionIdToWire } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import type { WireContext } from "./resource";

export interface ReportDiffOutcome {
  readonly mode: "structural" | "fallback";
  readonly html: string;
  readonly label: string | null;
  readonly fromVersionId: VersionId;
  readonly toVersionId: VersionId;
  readonly fromVersionNo: number;
  readonly toVersionNo: number;
}

export function reportDiffToHttp(
  result: Result<ReportDiffOutcome, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { mode, html, label, fromVersionId, toVersionId, fromVersionNo, toVersionNo } =
    result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: {
      object: "report_diff" as const,
      diff_mode: mode,
      html,
      label,
      from: { id: versionIdToWire(fromVersionId), version_no: fromVersionNo },
      to: { id: versionIdToWire(toVersionId), version_no: toVersionNo },
      mode: ctx.mode,
    },
  };
}
