// Reusable Zod primitives for env vars (all env values arrive as strings).
// Mirrors the schemaHelpers idea from the reference, in plain Zod 4.
import { z } from "zod";

/** Non-empty, trimmed string. */
export const trimmedString = z.string().trim().min(1);

/** "8080" → 8080. */
export const coercedNumber = z.coerce.number();

/** "true"/"TRUE" → true; anything else → false. */
export const boolFromString = z.string().transform((v) => v.trim().toLowerCase() === "true");

/** "a, b ,c" → ["a","b","c"] (empties dropped). */
export const csvList = z.string().transform((v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
