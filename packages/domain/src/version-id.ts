// VersionId smart constructor + wire codec (ADR-0052, ADR-0065). `versionId()` in
// brand.ts is a bare cast for a trusted internal value; `makeVersionId` DECODES +
// validates an untrusted client `version_…` External Id into the internal uuid — a
// bare uuid (or wrong prefix) is a 422 (clean break). `versionIdToWire` encodes the
// internal id for output. First consumer: GET /api/v1/reports/{slug}/versions.
import type { VersionId } from "./brand";
import { versionId } from "./brand";
import type { AppError } from "./errors";
import { decodeExternalId, encodeExternalId } from "./external-id";
import { ok, type Result } from "./result";

const PREFIX = "version";

export const makeVersionId = (raw: string): Result<VersionId, AppError> => {
  const decoded = decodeExternalId(PREFIX, raw, "versionId");
  if (!decoded.ok) return decoded;
  return ok(versionId(decoded.value));
};

export const versionIdToWire = (id: VersionId): string => encodeExternalId(PREFIX, id);
