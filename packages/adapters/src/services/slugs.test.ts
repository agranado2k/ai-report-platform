import { makeSlug } from "arp-domain";
import { describe, expect, it } from "vitest";
import { NanoidSlugFactory } from "./slugs";

describe("NanoidSlugFactory", () => {
  const slugs = new NanoidSlugFactory();

  it("produces slugs the domain accepts", () => {
    const slug = slugs.newSlug();
    expect(makeSlug(slug).ok).toBe(true);
    expect(slug).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it("is unique across calls", () => {
    const seen = new Set(Array.from({ length: 100 }, () => slugs.newSlug()));
    expect(seen.size).toBe(100);
  });
});
