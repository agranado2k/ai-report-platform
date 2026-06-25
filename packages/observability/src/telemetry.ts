// OpenTelemetry init (ADR-0055) — wraps @vercel/otel's registerOTel so the Vercel
// apps get serverless-safe span flushing. Fail-open: with no OTLP endpoint
// configured, telemetry is simply off and the app boots normally (the API_KEY_PEPPER
// pattern). Called once from each app's server entry; never from domain/application.
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPHttpProtoTraceExporter, registerOTel } from "@vercel/otel";

/** The env this module reads (the OTLP endpoint/headers are read by the SDK itself;
 *  we only gate on the endpoint's presence). Compatible with `process.env`. */
type TelemetryEnv = Record<string, string | undefined>;

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

/**
 * Parse OTEL_EXPORTER_OTLP_HEADERS (`k=v,k2=v2`) into a headers object, percent-
 * DECODING each value (ADR-0055). The OTel JS exporters don't reliably decode the
 * env value themselves, so a `%20` in `Authorization=Basic%20<token>` shipped a
 * malformed header → Grafana 401 → all telemetry silently dropped. We parse it
 * ourselves and pass explicit headers to the exporters, so any encoding works. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!key) continue;
    try {
      headers[key] = decodeURIComponent(value);
    } catch {
      headers[key] = value; // not percent-encoded → use as-is
    }
  }
  return headers;
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
 * Initialize tracing + logs (ADR-0055). We construct the OTLP exporters EXPLICITLY
 * (endpoint + decoded headers from env) rather than relying on @vercel/otel / the
 * SDK to read OTEL_EXPORTER_OTLP_* — that implicit path didn't ship the app's
 * spans/logs to Grafana (and mis-handled the `%20` in the auth header). @vercel/otel
 * still wraps the trace exporter with serverless-safe flushing. Idempotent +
 * fail-open. Returns whether telemetry was started. (Metrics lands in a follow-up.)
 */
export function initTelemetry(opts: TelemetryOptions, env: TelemetryEnv = process.env): boolean {
  if (started) return true;
  if (!isTelemetryEnabled(env)) return false;

  // Gate guarantees the endpoint is present; strip a trailing slash so the signal
  // paths (`/v1/traces`, `/v1/logs`) don't double up.
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT as string).trim().replace(/\/+$/, "");
  const headers = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);

  registerOTel({
    serviceName: opts.service,
    attributes: resourceAttributes(opts),
    // "fetch" → outbound propagation (MCP→/api/v1). PinoInstrumentation injects
    // trace_id/span_id into pino logs AND bridges them to the Logs SDK; the OTLP
    // log processor ships them to Loki (ADR-0055).
    instrumentations: ["fetch", new PinoInstrumentation()],
    // Explicit OTLP/HTTP protobuf trace exporter → Tempo (@vercel/otel adds the
    // serverless flush). Explicit endpoint + decoded auth headers.
    traceExporter: new OTLPHttpProtoTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers })),
    ],
  });
  started = true;
  return true;
}
