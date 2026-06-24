// The app's shared structured logger (ADR-0055). pino + source-side redaction; the
// OTel PinoInstrumentation (registered in instrument.server) injects trace_id/span_id
// and bridges these records to Loki. Use at the boundaries — never in domain/application.
import { createLogger } from "arp-observability";

export const log = createLogger({ service: "arp-app" });
