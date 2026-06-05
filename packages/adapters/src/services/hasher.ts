// Hasher adapter — SHA-256 hex. Backs the derived idempotency key (ADR-0039:
// hash(user ∥ route ∥ content_hash ∥ target)). Boundary layer (ADR-0020).
import { createHash } from "node:crypto";
import type { Hasher } from "arp-application";

export class Sha256Hasher implements Hasher {
  hash(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
  }
}
