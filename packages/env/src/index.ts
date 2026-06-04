// Public surface of the env package. Consumers call defineEnv() once at their
// composition root (server/adapter boundary) and import the typed result.
// Boundary-only (ADR-0043): never imported by packages/domain or
// packages/application (ADR-0024 keeps those dependency-locked + vanilla).
export * from './schema-helpers';
export * from './schema';
export * from './define-env';
