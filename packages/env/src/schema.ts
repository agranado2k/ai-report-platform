// The platform's environment contract (Phase 1 surface). Split into server-only
// secrets and client-safe PUBLIC_ vars so @t3-oss/env-core can guarantee a
// secret never reaches the browser bundle. Grows as later phases add vars.
import { z } from 'zod';
import { trimmedString } from './schema-helpers';

/** Server-only — secrets + infra. NEVER bundled to the client. */
export const serverSchema = {
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Neon (Reports & Folders persistence, ADR-0004/0020).
  DATABASE_URL: z.url(),

  // Cloudflare R2 (blob storage, ADR-0004).
  R2_ACCOUNT_ID: trimmedString,
  R2_ACCESS_KEY_ID: trimmedString,
  R2_SECRET_ACCESS_KEY: trimmedString,
  R2_BUCKET: trimmedString,

  // Clerk server key (ADR-0005). The publishable key is client-safe — see below.
  CLERK_SECRET_KEY: trimmedString,

  // Upstash rate-limiting (ADR-0011) — wired in Phase 1.5, so optional for now.
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: trimmedString.optional(),
} as const;

/**
 * Client-safe vars. Must carry the PUBLIC_ prefix (enforced by clientPrefix at
 * type + runtime). More land in VS-3 when the apps read public vars in-browser.
 */
export const clientSchema = {
  PUBLIC_CLERK_PUBLISHABLE_KEY: trimmedString,
} as const;
