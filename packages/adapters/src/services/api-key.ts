// API-key service (ADR-0008) — mint + HMAC + constant-time verify for the
// `arp_live_…` / `arp_test_…` keys that authenticate programmatic callers (the MCP
// server, scripts, agents) against `/api/v1`, alongside Clerk sessions (ADR-0016
// scopes). Boundary layer (ADR-0020): all crypto (`node:crypto`) lives here.
//
// Token shape: `arp_<env>_<43 url-safe base64 chars>` (32 random bytes). Only the
// HMAC is persisted (`api_keys.key_hash`); the secret is shown to the user exactly
// once. The first 12 chars are the non-secret `key_prefix` — an indexed lookup
// column, so verification narrows to a few candidate rows before the constant-time
// compare.
//
// Hashing is **HMAC-SHA-256 keyed by a server-side pepper** (env `API_KEY_PEPPER`),
// NOT argon2id as spec.html ADR-008 originally proposed: the keys are 256-bit
// random, so a slow password hash buys nothing and would add latency to every
// `/api/v1` request, while the pepper means a DB-only leak can't even verify
// guesses. The amendment + rationale are recorded in docs/adr/0008. Fail-closed:
// with no pepper configured, minting throws and verification always returns false.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_NAMESPACE = "arp";
/** Width of the indexed lookup prefix (matches `api_keys.key_prefix` varchar(12)). */
const PREFIX_LENGTH = 12;
/** Random entropy per key, in bytes. */
const SECRET_BYTES = 32;

export interface ApiKeyConfig {
  /** Server-side HMAC pepper (env `API_KEY_PEPPER`). Empty ⇒ API keys disabled (fail-closed). */
  readonly pepper: string;
  /** Environment label stamped into minted keys: `arp_live_…` (prod) / `arp_test_…`. Default `live`. */
  readonly label?: "live" | "test";
}

export interface MintedApiKey {
  /** The full secret — returned to the caller ONCE, never persisted. */
  readonly token: string;
  /** Indexed, non-secret lookup prefix (the token's first 12 chars). */
  readonly prefix: string;
  /** HMAC-SHA-256 hex of the token — the only thing persisted. */
  readonly hash: string;
}

export class ApiKeyService {
  constructor(private readonly config: ApiKeyConfig) {}

  private get enabled(): boolean {
    return this.config.pepper.length > 0;
  }

  /** Mint a fresh key: a random secret plus its derived lookup prefix and stored hash. */
  generate(): MintedApiKey {
    if (!this.enabled) throw new Error("ApiKeyService: API_KEY_PEPPER is not configured");
    const label = this.config.label ?? "live";
    const token = `${TOKEN_NAMESPACE}_${label}_${randomBytes(SECRET_BYTES).toString("base64url")}`;
    return { token, prefix: this.prefixOf(token), hash: this.hash(token) };
  }

  /** The indexed lookup prefix of a presented token. */
  prefixOf(token: string): string {
    return token.slice(0, PREFIX_LENGTH);
  }

  /** HMAC-SHA-256 hex of a token, keyed by the server pepper. */
  hash(token: string): string {
    if (!this.enabled) throw new Error("ApiKeyService: API_KEY_PEPPER is not configured");
    return createHmac("sha256", this.config.pepper).update(token, "utf8").digest("hex");
  }

  /** Constant-time check that `token` HMACs to `expectedHash`. Length-guarded; fail-closed. */
  verify(token: string, expectedHash: string): boolean {
    if (!this.enabled) return false;
    const actual = Buffer.from(this.hash(token), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
