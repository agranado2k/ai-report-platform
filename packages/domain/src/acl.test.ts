import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCESS_TTL_SECONDS,
  isPrivateAcl,
  MAX_ACCESS_TTL_SECONDS,
  makeAcl,
  PUBLIC_ACL,
} from "./acl";
import type { AclMode } from "./value-objects";

describe("Acl (ADR-0056)", () => {
  it("PUBLIC_ACL is the default and is not private", () => {
    expect(PUBLIC_ACL).toEqual({ mode: "public" });
    expect(isPrivateAcl(PUBLIC_ACL)).toBe(false);
  });

  it("org / password / allowlist are private (need authorization)", () => {
    expect(isPrivateAcl({ mode: "org" })).toBe(true);
    expect(isPrivateAcl({ mode: "password", passwordHash: "h" })).toBe(true);
    expect(
      isPrivateAcl({ mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 3600 }),
    ).toBe(true);
  });

  it("makeAcl builds public / org with no extra data", () => {
    expect(makeAcl({ mode: "public" })).toEqual({ ok: true, value: { mode: "public" } });
    expect(makeAcl({ mode: "org" })).toEqual({ ok: true, value: { mode: "org" } });
  });

  it("makeAcl(password) requires a non-empty hash (the use case supplies the argon2id hash)", () => {
    const ok = makeAcl({ mode: "password", passwordHash: "$argon2id$..." });
    expect(ok.ok && ok.value).toEqual({ mode: "password", passwordHash: "$argon2id$..." });
    expect(makeAcl({ mode: "password" }).ok).toBe(false);
    expect(makeAcl({ mode: "password", passwordHash: "  " }).ok).toBe(false);
  });

  it("makeAcl(allowlist) requires ≥1 email; normalizes (trim + lowercase + dedupe); defaults TTL", () => {
    const r = makeAcl({ mode: "allowlist", allowedEmails: ["A@B.com", " c@d.io ", "a@b.com"] });
    expect(r.ok && r.value).toEqual({
      mode: "allowlist",
      allowedEmails: ["a@b.com", "c@d.io"],
      accessTtlSeconds: DEFAULT_ACCESS_TTL_SECONDS,
    });
    expect(makeAcl({ mode: "allowlist", allowedEmails: [] }).ok).toBe(false);
    expect(makeAcl({ mode: "allowlist", allowedEmails: ["not-an-email"] }).ok).toBe(false);
  });

  it("makeAcl(allowlist) takes an owner-set access TTL and validates its range", () => {
    const ok = makeAcl({ mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 86_400 });
    expect(ok.ok && ok.value).toEqual({
      mode: "allowlist",
      allowedEmails: ["a@b.com"],
      accessTtlSeconds: 86_400,
    });
    // out of range / non-integer → rejected
    expect(makeAcl({ mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 5 }).ok).toBe(
      false,
    );
    expect(
      makeAcl({
        mode: "allowlist",
        allowedEmails: ["a@b.com"],
        accessTtlSeconds: MAX_ACCESS_TTL_SECONDS + 1,
      }).ok,
    ).toBe(false);
    expect(
      makeAcl({ mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 1.5 }).ok,
    ).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(makeAcl({ mode: "bogus" as AclMode }).ok).toBe(false);
  });
});
