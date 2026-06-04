// Public surface of the env package. Consumers call defineEnv() once at their
// composition root (server/adapter boundary) and import the typed result.
// Boundary-only (ADR-0043): never imported by packages/domain or
// packages/application (ADR-0024 keeps those dependency-locked + vanilla).
//
// schema-helpers are intentionally NOT re-exported here — they're internal
// schema-building blocks. Keeping them off the main surface stops a consumer
// from pulling raw Zod through `arp-env`. Adapters that need them import via
// the `arp-env/schema-helpers` sub-path (see package.json exports).

export * from "./define-env";
export * from "./schema";
