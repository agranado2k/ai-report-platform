// UserId smart constructor + wire codec (ADR-0052, ADR-0059, ADR-0065).
// `userId()` in brand.ts is a bare cast for trusted internal values (a DB PK);
// `userIdToWire` encodes the internal uuid as the `user_…` External Id — the
// report resource exposes it as `owner` (ADR-0059 §6), and version-history
// exposes it as `uploaded_by` (ADR-0065). Clerk's own user ids are a separate
// branded ClerkUserId and are NEVER serialized (ADR-0052 §5). `makeUserId`
// DECODES + validates an untrusted client `user_…` External Id back into the
// internal uuid for when a boundary accepts one — a bare uuid (or wrong
// prefix) is a 422 (clean break).
import type { UserId } from "./brand";
import { userId } from "./brand";
import type { AppError } from "./errors";
import { decodeExternalId, encodeExternalId } from "./external-id";
import { ok, type Result } from "./result";

const PREFIX = "user";

export const makeUserId = (raw: string): Result<UserId, AppError> => {
  const decoded = decodeExternalId(PREFIX, raw, "userId");
  if (!decoded.ok) return decoded;
  return ok(userId(decoded.value));
};

export const userIdToWire = (id: UserId): string => encodeExternalId(PREFIX, id);
