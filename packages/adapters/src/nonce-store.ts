// UpstashNonceStore — the NonceStore port (ADR-0056) over the Upstash Redis REST
// API (ADR-0011). Single-use magic-link nonces: SET … EX on put, GETDEL on take.
// Plain `fetch` (no SDK); `fetchImpl` injectable for tests. Any HTTP/Upstash error →
// a Result error (never throws). Bounded by a 5s timeout so a hung call can't block.
import type { NonceStore } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

export interface UpstashConfig {
  /** Upstash REST URL, e.g. `https://<id>.upstash.io`. */
  readonly url: string;
  /** Upstash REST token (Bearer). */
  readonly token: string;
  /** Injectable fetch for tests; defaults to the global. */
  readonly fetchImpl?: typeof fetch;
}

const nonceKey = (id: string) => `nonce:${id}`;

/** Run one Redis command over the Upstash REST API (`POST url` with a JSON arg array). */
async function command(
  cfg: UpstashConfig,
  args: (string | number)[],
): Promise<Result<unknown, AppError>> {
  const doFetch = cfg.fetchImpl ?? fetch;
  try {
    const res = await doFetch(cfg.url, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) return err({ kind: "Unexpected", message: `upstash http ${res.status}` });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) return err({ kind: "Unexpected", message: `upstash: ${json.error}` });
    return ok(json.result ?? null);
  } catch (e) {
    return err({ kind: "Unexpected", message: `upstash error: ${String(e)}` });
  }
}

export class UpstashNonceStore implements NonceStore {
  constructor(private readonly cfg: UpstashConfig) {}

  async put(id: string, value: string, ttlSeconds: number): Promise<Result<void, AppError>> {
    const r = await command(this.cfg, ["SET", nonceKey(id), value, "EX", ttlSeconds]);
    return r.ok ? ok(undefined) : r;
  }

  async take(id: string): Promise<Result<string | null, AppError>> {
    const r = await command(this.cfg, ["GETDEL", nonceKey(id)]);
    if (!r.ok) return r;
    return ok(r.value === null || r.value === undefined ? null : String(r.value));
  }
}
