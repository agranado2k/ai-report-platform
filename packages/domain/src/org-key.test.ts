import { describe, expect, it } from "vitest";
import { PUBLIC_PROVIDER_DOMAINS, resolveOrgKey } from "./org-key";

describe("resolveOrgKey (ADR-0068 §1 — domain-keyed single-org membership)", () => {
  describe("public-provider addresses → a personal org keyed by the full address", () => {
    it.each([...PUBLIC_PROVIDER_DOMAINS])("maps %s to a personal org", (domain) => {
      const r = resolveOrgKey(`Someone@${domain}`);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual({ kind: "personal", key: `someone@${domain}` });
      }
    });

    it("normalizes (trim + lowercase) the address used as the personal org key", () => {
      const r = resolveOrgKey("  Agranado2K@Gmail.COM  ");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual({ kind: "personal", key: "agranado2k@gmail.com" });
    });
  });

  describe("corporate domains → a team org keyed by the domain", () => {
    it("maps a plain corporate domain to a team org keyed by the lowercased domain", () => {
      const r = resolveOrgKey("Arthur@HouseNumbers.io");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual({ kind: "team", key: "housenumbers.io" });
    });

    it("puts two different local-parts at the same corporate domain in the same team org", () => {
      const a = resolveOrgKey("arthur@housenumbers.io");
      const b = resolveOrgKey("my_coworker@housenumbers.io");
      expect(a.ok && b.ok && a.value.key === b.value.key).toBe(true);
      expect(a.ok && a.value.kind).toBe("team");
    });

    it("keys a two-level-TLD corporate domain (e.g. co.uk) by the FULL domain, not an eTLD+1 guess", () => {
      const r = resolveOrgKey("person@acme.co.uk");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual({ kind: "team", key: "acme.co.uk" });
    });

    it("does NOT treat a domain that merely contains a public-provider name as public (no substring/suffix matching)", () => {
      // "notgmail.com" and "gmail.com.evil.com" must NOT match "gmail.com" — only
      // an exact, whole-domain match against the public-provider list counts.
      expect(resolveOrgKey("a@notgmail.com")).toMatchObject({ ok: true, value: { kind: "team" } });
      expect(resolveOrgKey("a@gmail.com.evil.com")).toMatchObject({
        ok: true,
        value: { kind: "team" },
      });
    });

    it("treats an unlisted subdomain of a public provider as its own team org (documented boundary case — exact match only, no suffix stripping)", () => {
      const r = resolveOrgKey("a@mail.yahoo.co.jp");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual({ kind: "team", key: "mail.yahoo.co.jp" });
    });
  });

  describe("invalid input", () => {
    it("rejects a malformed email", () => {
      const r = resolveOrgKey("not-an-email");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("ValidationError");
    });
  });
});
