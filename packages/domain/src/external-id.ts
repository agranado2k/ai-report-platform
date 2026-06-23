// External-id codec (ADR-0052): `<prefix>_<base62(uuid)>`. A reversible encoding of
// the internal UUIDv7 PK — `encodeExternalId` for the wire, `decodeExternalId`
// (validating) at the boundary. Vanilla TS + BigInt (ADR-024), no deps.
//
// Fixed width: a uuid is 128 bits = at most 22 base62 chars (ceil(128/log2 62)).
// We always emit exactly 22 (left-padded), so a leading-zero uuid round-trips
// deterministically. On decode we reject anything that isn't exactly 22 valid
// chars OR that overflows 128 bits (some 22-char strings exceed 2^128).
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { Result } from "./result";
import { err, ok } from "./result";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62n;
const WIDTH = 22;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical hyphenated uuid → `<prefix>_<22-char base62>`. Trusted input (a PK). */
export function encodeExternalId(prefix: string, uuid: string): string {
  let n = BigInt(`0x${uuid.replace(/-/g, "")}`);
  let body = "";
  for (let i = 0; i < WIDTH; i++) {
    body = ALPHABET[Number(n % BASE)] + body;
    n /= BASE;
  }
  return `${prefix}_${body}`;
}

/** `<prefix>_<base62>` → canonical hyphenated uuid, or a ValidationError (422). */
export function decodeExternalId(
  prefix: string,
  wire: string,
  field: string,
): Result<string, AppError> {
  const bad = () => err(validationError(`must be a valid ${field} (${prefix}_…)`, field));
  const head = `${prefix}_`;
  if (!wire.startsWith(head)) return bad();
  const body = wire.slice(head.length);
  if (body.length !== WIDTH) return bad();

  let n = 0n;
  for (const ch of body) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) return bad();
    n = n * BASE + BigInt(d);
  }
  const hex = n.toString(16);
  if (hex.length > 32) return bad(); // > 2^128 — not a uuid
  const padded = hex.padStart(32, "0");
  const uuid = `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20)}`;
  return UUID_RE.test(uuid) ? ok(uuid) : bad();
}
