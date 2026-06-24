// Structured pino logger with source-side redaction (ADR-0055). The OTel pino
// instrumentation injects trace_id/span_id at runtime; this module owns the shape
// + the redaction denylist so no secret/PII reaches Loki. Used by adapters + apps
// only — never by domain/application (ADR-0024).
import pino, { type DestinationStream, type Logger } from "pino";

/** Denylist of log-field paths scrubbed before emission (ADR-0055). pino `redact`
 *  paths support a single `*` wildcard per segment, so we cover top-level + one
 *  level of nesting for the common carriers. */
export const REDACT_PATHS: readonly string[] = [
  // auth headers / credentials
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.cookie",
  'headers["x-api-key"]',
  "x-api-key",
  "*.x-api-key",
  // secrets / tokens
  "token",
  "*.token",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "keyHash",
  "key_hash",
  // PII
  "email",
  "*.email",
];

export interface LoggerOptions {
  /** Resource service name — arp-app / arp-mcp / arp-worker (ADR-0055). */
  readonly service: string;
  readonly level?: string;
}

/** Build the shared structured logger. Pass a `destination` in tests to capture output. */
export function createLogger(opts: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: opts.level ?? "info",
      // Replaces pino's default {pid, hostname} base — those are noise on
      // ephemeral serverless; service is the useful resource discriminator.
      base: { service: opts.service },
      redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
