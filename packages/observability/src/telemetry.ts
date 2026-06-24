// OpenTelemetry init (ADR-0055) — wraps @vercel/otel's registerOTel so the Vercel
// apps get serverless-safe span flushing. Fail-open: with no OTLP endpoint
// configured, telemetry is simply off and the app boots normally (the API_KEY_PEPPER
// pattern). Called once from each app's server entry; never from domain/application.
import { registerOTel } from "@vercel/otel";

/** Minimal view of the env this module reads (the OTLP endpoint/headers are read by
 *  the SDK itself; we only gate on the endpoint's presence). */
interface TelemetryEnv {
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

export interface TelemetryOptions {
  /** Resource service.name — arp-app / arp-mcp / arp-worker (ADR-0055). */
  readonly service: string;
  /** Release tag → service.version (correlate a regression to a deploy). */
  readonly version?: string;
  /** prod / preview / dev → deployment.environment. */
  readonly environment?: string;
}

/** Fail-open gate: telemetry is on only when an OTLP endpoint is configured. */
export function isTelemetryEnabled(env: TelemetryEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

/** The OTel resource attributes — only set the ones we have (ADR-0055). */
export function resourceAttributes(opts: TelemetryOptions): Record<string, string> {
  return {
    ...(opts.version ? { "service.version": opts.version } : {}),
    ...(opts.environment ? { "deployment.environment": opts.environment } : {}),
  };
}

let started = false;

/**
 * Initialize tracing (this slice). The OTLP trace exporter + auth header are read
 * by @vercel/otel from OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS, and
 * it force-flushes spans before Vercel freezes the function. Idempotent + fail-open.
 * Returns whether telemetry was started. (Logs + metrics pillars wired in follow-ups.)
 */
export function initTelemetry(opts: TelemetryOptions, env: TelemetryEnv = process.env): boolean {
  if (started) return true;
  if (!isTelemetryEnabled(env)) return false;
  registerOTel({
    serviceName: opts.service,
    attributes: resourceAttributes(opts),
    instrumentations: ["fetch"], // fetch propagation → MCP→/api/v1 continuity
  });
  started = true;
  return true;
}
