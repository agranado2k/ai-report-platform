// Clock adapter — UTC epoch milliseconds (the domain Timestamp). Boundary
// layer (ADR-0020): use cases take a Clock so they stay pure + deterministic
// under test (the in-memory FixedClock); production uses the wall clock.
import type { Clock } from "arp-application";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
