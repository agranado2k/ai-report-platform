import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

/** Collect pino's NDJSON output lines for assertions. */
function capture() {
  const lines: string[] = [];
  return { stream: { write: (s: string) => lines.push(s) }, lines };
}

describe("createLogger — source-side redaction (ADR-0055)", () => {
  it("redacts secrets, auth headers, tokens, and email; keeps business ids", () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: "arp-app" }, stream);

    log.info(
      {
        authorization: "Bearer arp_live_supersecret",
        email: "alice@example.com",
        headers: { cookie: "session=abc", "x-api-key": "arp_live_zzz" },
        nested: { token: "whsec_webhooksecret" },
        report_id: "report_033abc", // business id — must survive
      },
      "upload received",
    );

    const rec = JSON.parse(lines[0] ?? "{}");
    expect(rec.authorization).toBe("[REDACTED]");
    expect(rec.email).toBe("[REDACTED]");
    expect(rec.headers.cookie).toBe("[REDACTED]");
    expect(rec.headers["x-api-key"]).toBe("[REDACTED]");
    expect(rec.nested.token).toBe("[REDACTED]");
    expect(rec.report_id).toBe("report_033abc"); // not redacted
    expect(rec.service).toBe("arp-app");
    expect(rec.msg).toBe("upload received");
  });

  it("drops pid/hostname noise (serverless base) and emits JSON", () => {
    const { stream, lines } = capture();
    createLogger({ service: "arp-mcp" }, stream).warn("heads up");
    const rec = JSON.parse(lines[0] ?? "{}");
    expect(rec.pid).toBeUndefined();
    expect(rec.hostname).toBeUndefined();
    expect(rec.service).toBe("arp-mcp");
  });
});
