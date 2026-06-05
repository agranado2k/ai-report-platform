// SlugFactory adapter — a fresh Report slug is nanoid(10) over the default
// URL-safe alphabet, which is exactly what the domain's makeSlug accepts
// (slug.ts SLUG_RE = /^[A-Za-z0-9_-]{10}$/). Boundary layer (ADR-0020).
import type { SlugFactory } from "arp-application";
import { makeSlug, type Slug } from "arp-domain";
import { nanoid } from "nanoid";

export class NanoidSlugFactory implements SlugFactory {
  newSlug(): Slug {
    const candidate = nanoid(10);
    const result = makeSlug(candidate);
    if (!result.ok) {
      // nanoid's alphabet is a subset of the slug alphabet, so this is
      // unreachable — guard loudly rather than cast past the smart constructor.
      throw new Error(`generated slug failed domain validation: ${candidate}`);
    }
    return result.value;
  }
}
