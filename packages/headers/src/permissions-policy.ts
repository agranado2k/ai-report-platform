export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "usb=()",
  "payment=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "midi=()",
  "serial=()",
  "bluetooth=()",
  "interest-cohort=()",
].join(", ");

export const HSTS = "max-age=63072000; includeSubDomains; preload";

/** The slice of the environment `resolveReportToUrl` needs — narrower than
 *  `process.env` so a test can inject exactly `{ APP_ORIGIN }` (or `{}`) without
 *  touching the real process environment. */
export interface ReportToUrlEnv {
  readonly APP_ORIGIN?: string;
}

/** The real process environment, read lazily so importing this module never
 *  touches `process` at module-load time (kept working in non-Node runtimes). */
function processEnv(): ReportToUrlEnv {
  return (globalThis as { process?: { env?: ReportToUrlEnv } }).process?.env ?? {};
}

/**
 * Resolve the CSP `Report-To` target: an explicit `override` wins; otherwise
 * `${env.APP_ORIGIN}/csp-report`; otherwise the localhost dev default. `env`
 * defaults to the real `process.env` (production wiring) but is injectable so
 * tests can exercise the fallback deterministically instead of mutating the
 * real environment.
 */
export function resolveReportToUrl(override?: string, env: ReportToUrlEnv = processEnv()): string {
  if (override) return override;
  return env.APP_ORIGIN ? `${env.APP_ORIGIN}/csp-report` : "https://app.localhost/csp-report";
}

export function reportToHeader(url: string): string {
  return JSON.stringify({
    group: "csp-endpoint",
    max_age: 10886400,
    endpoints: [{ url }],
  });
}
