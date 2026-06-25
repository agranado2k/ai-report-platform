import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "./password-hasher";

describe("Argon2PasswordHasher (ADR-0056)", () => {
  const hasher = new Argon2PasswordHasher();

  it("hashes to an argon2id string and verifies the right password", async () => {
    const h = await hasher.hash("hunter2");
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.value.startsWith("$argon2id$")).toBe(true);

    const good = await hasher.verify("hunter2", h.value);
    expect(good.ok && good.value).toBe(true);

    const bad = await hasher.verify("wrong-password", h.value);
    expect(bad.ok && bad.value).toBe(false);
  });

  it("salts — the same password hashes to a different string each time", async () => {
    const a = await hasher.hash("same");
    const b = await hasher.hash("same");
    expect(a.ok && b.ok && a.value !== b.value).toBe(true);
  });

  it("a malformed stored hash surfaces as an error (not a silent match)", async () => {
    const r = await hasher.verify("pw", "not-an-argon2-hash");
    expect(r.ok).toBe(false);
  });
});
