// FolderId smart constructor (ADR-0036). `folderId()` in brand.ts is a bare cast
// for trusted internal values; `makeFolderId` VALIDATES an untrusted client value
// is a well-formed UUID, so a malformed input maps to a 422 ValidationError at the
// route boundary instead of reaching the DB (where a non-uuid throws → 500).
import type { FolderId } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { Result } from "./result";
import { err, ok } from "./result";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const makeFolderId = (raw: string): Result<FolderId, AppError> =>
  UUID_RE.test(raw)
    ? ok(raw as FolderId)
    : err(validationError("must be a valid folder id (UUID)", "folderId"));
