// OpenTelemetry init (ADR-0055). Imported FIRST in entry.server.tsx so registration
// runs before request handling. Fail-open: with no OTLP endpoint, initTelemetry is a
// no-op and the app boots normally.
import { initTelemetry } from "arp-observability";

initTelemetry({
  service: "arp-app",
  environment: process.env.VERCEL_ENV, // production | preview | development
  version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
});
