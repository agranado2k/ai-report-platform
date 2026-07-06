// Cursor-pagination parsing (ADR-0053). Pure — no I/O, no app dependencies —
// so it lives here alongside the other arp-http request-parse helpers rather
// than in the app's server/ (route-seam deepening: rehoming marooned pure
// logic, ADR-0024).
import { type AppError, err, ok, type Result, validationError } from "arp-domain";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse the cursor-pagination params (ADR-0053): `limit` (clamped 1..100, default
 * 20) + `starting_after`/`ending_before` decoded via the entity's `make*Id` (a
 * malformed cursor → 422). The single place the pagination rule lives.
 */
export function parseCursorParams<Id>(
  sp: URLSearchParams,
  decode: (s: string) => Result<Id, AppError>,
): Result<{ limit: number; startingAfter?: Id; endingBefore?: Id }, AppError> {
  const raw = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;

  const out: { limit: number; startingAfter?: Id; endingBefore?: Id } = { limit };
  const after = sp.get("starting_after")?.trim();
  const before = sp.get("ending_before")?.trim();
  if (after && before) {
    return err(validationError("pass only one of starting_after / ending_before", "cursor"));
  }
  if (after) {
    const d = decode(after);
    if (!d.ok) return d;
    out.startingAfter = d.value;
  }
  if (before) {
    const d = decode(before);
    if (!d.ok) return d;
    out.endingBefore = d.value;
  }
  return ok(out);
}
