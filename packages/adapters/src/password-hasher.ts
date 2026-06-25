// Argon2PasswordHasher — the PasswordHasher port (ADR-0056) backed by @node-rs/argon2
// (Rust, prebuilt binaries — no node-gyp on Vercel). Defaults to argon2id, the
// OWASP-recommended variant (db-design.md). Used for `password`-mode report ACLs;
// never stores plaintext. argon2 is deliberately slow/memory-hard (unlike the
// API-key HMAC) because human passwords are low-entropy.
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { PasswordHasher } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<Result<string, AppError>> {
    try {
      // @node-rs/argon2 defaults to argon2id with sound cost params + a random salt.
      return ok(await argon2Hash(plaintext));
    } catch (e) {
      return err({ kind: "Unexpected", message: `password hashing failed: ${String(e)}` });
    }
  }

  async verify(plaintext: string, hash: string): Promise<Result<boolean, AppError>> {
    try {
      // Returns false for a wrong password; throws only on a malformed/corrupt hash
      // string — which we surface as an error (a data-integrity issue), not a match.
      return ok(await argon2Verify(hash, plaintext));
    } catch (e) {
      return err({ kind: "Unexpected", message: `password verification failed: ${String(e)}` });
    }
  }
}
