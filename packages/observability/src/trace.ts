// Active-trace helpers (ADR-0055). Used at the HTTP boundary to derive the
// Request-Id from the current trace (Request-Id = req_<base62(trace_id)>), so a
// support id decodes straight to a Tempo trace. Pure read of the OTel context.
import { trace } from "@opentelemetry/api";

/** The all-zero trace id OTel returns when there is no real (sampled) span. */
const INVALID_TRACE_ID = "00000000000000000000000000000000";

/** The current request's trace id, or undefined when no trace is active. */
export function activeTraceId(): string | undefined {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && id !== INVALID_TRACE_ID ? id : undefined;
}
