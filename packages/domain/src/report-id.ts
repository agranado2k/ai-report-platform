// ReportId smart constructor + wire codec (ADR-0052). A Report carries TWO public
// handles: its `Slug` (capability / view URL — ADR-0038) and its `report_…`
// External Id (authenticated API addressing). `reportId()` in brand.ts is a bare
// cast for a trusted internal value; `makeReportId` decodes + validates an
// untrusted `report_…` into the internal uuid; `reportIdToWire` encodes for output.
import type { ReportId } from "./brand";
import { reportId } from "./brand";
import type { AppError } from "./errors";
import { decodeExternalId, encodeExternalId } from "./external-id";
import { ok, type Result } from "./result";

const PREFIX = "report";

/** The full length of a report External Id: `report_` + 22 base62 chars. */
export const REPORT_ID_LENGTH = PREFIX.length + 1 + 22;

/** True if `s` is shaped like a report External Id (vs a Slug). Structural, not a
 *  bare prefix check — a nanoid Slug could coincidentally start `report_`. */
export const looksLikeReportId = (s: string): boolean =>
  s.length === REPORT_ID_LENGTH && s.startsWith(`${PREFIX}_`);

export const makeReportId = (raw: string): Result<ReportId, AppError> => {
  const decoded = decodeExternalId(PREFIX, raw, "reportId");
  if (!decoded.ok) return decoded;
  return ok(reportId(decoded.value));
};

export const reportIdToWire = (id: ReportId): string => encodeExternalId(PREFIX, id);
