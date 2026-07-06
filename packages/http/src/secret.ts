// Constant-time bearer-secret compare — pure logic (no framework/app
// dependencies), so it lives here alongside the other arp-http request
// helpers rather than marooned in a single route file (route-seam
// deepening: rehoming marooned pure logic, ADR-0024).
import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe compare of a presented secret against the expected one (e.g. the
 * scan-drain trigger's shared bearer secret). A byte-by-byte early-exit `===`
 * would leak the secret's matching prefix length via a response-time side
 * channel; `timingSafeEqual` doesn't. It requires equal-length buffers, so a
 * length mismatch is just a miss, not a throw.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
