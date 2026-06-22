// FolderId smart constructor + wire codec (ADR-0036, ADR-0052). `folderId()` in
// brand.ts is a bare cast for trusted internal values (a DB PK); `makeFolderId`
// DECODES + validates an untrusted client `folder_…` External Id into the internal
// uuid — a bare uuid (or wrong prefix) is a 422 (clean break). `folderIdToWire`
// encodes the internal id for output.
import type { FolderId } from "./brand";
import { folderId } from "./brand";
import type { AppError } from "./errors";
import { decodeExternalId, encodeExternalId } from "./external-id";
import { ok, type Result } from "./result";

const PREFIX = "folder";

export const makeFolderId = (raw: string): Result<FolderId, AppError> => {
  const decoded = decodeExternalId(PREFIX, raw, "folderId");
  if (!decoded.ok) return decoded;
  return ok(folderId(decoded.value));
};

export const folderIdToWire = (id: FolderId): string => encodeExternalId(PREFIX, id);
