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

export function resolveReportToUrl(override?: string): string {
  if (override) return override;
  const appOrigin = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
    ?.APP_ORIGIN;
  return appOrigin ? `${appOrigin}/csp-report` : "https://app.localhost/csp-report";
}

export function reportToHeader(url: string): string {
  return JSON.stringify({
    group: "csp-endpoint",
    max_age: 10886400,
    endpoints: [{ url }],
  });
}
