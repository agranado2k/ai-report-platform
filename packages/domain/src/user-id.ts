// UserId wire codec (ADR-0052). `userId()` in brand.ts is a bare cast for
// trusted internal values (a DB PK); `userIdToWire` encodes the internal uuid
// as the `user_…` External Id the report resource exposes as its `owner`
// (ADR-0059 §6). Clerk's own user ids are a separate branded ClerkUserId and
// are NEVER serialized (ADR-0052 §5). `makeUserId` decodes an untrusted
// `user_…` back to the internal uuid for when a boundary accepts one.
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
